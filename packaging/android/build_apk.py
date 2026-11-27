#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 Next.js standalone 构建打包进 LibreTV 安卓壳 APK（nodejs-mobile 版）。

用法示例：
    python build_apk.py \
        --base-apk LibreTV-2.21.0-shell.apk \
        --standalone .next/standalone \
        --out LibreTV-Android-v2.21.1-universal.apk \
        --version-name 2.21.1-phone \
        --zipalign /path/to/zipalign \
        --apksigner /path/to/apksigner \
        --keystore libretv.keystore --ks-pass libretv123 --key-pass libretv123

只做重打包、不签名时，省略 --apksigner/--keystore，会输出 *-unsigned.apk，
随后手动执行：
    zipalign -f 4 unsigned.apk aligned.apk
    apksigner sign --ks libretv.keystore --ks-pass pass:xxx --key-pass pass:xxx --out final.apk aligned.apk

脚本做的事：
1. 从 base APK 里取出 assets/nodejs-project/server.js 的「dpad 注入包装头」
   （以 "/* ===== 结束 dpad 注入包装器 ===== */" 结尾），和新的 standalone
   server.js 拼成新的 server.js；
2. 把 nextConfig 的 compress 关掉（dpad 注入要往明文 HTML 里塞 <script>，
   开了 gzip 会直接破坏响应体）；
3. 用 standalone/.next 替换 assets/nodejs-project/nextbuild/（AGP 打包会排除
   以点开头的目录，所以 APK 内目录名是 nextbuild，运行时由 main.js 改回 .next）；
4. 替换 package.json，并按需等长改写 AndroidManifest 里的 versionName；
5. 丢掉旧的 META-INF 签名，重新写 zip（AndroidManifest.xml / classes.dex /
   resources.arsc 保持 STORED），最后 zipalign + apksigner 签名。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

WRAPPER_MARKER = "/* ===== 结束 dpad 注入包装器 ===== */"
ASSET_PREFIX = "assets/nodejs-project/"
STORED_ENTRIES = {"AndroidManifest.xml", "classes.dex", "resources.arsc"}


def merge_server(base_server_text: str, standalone_server_path: str) -> str:
    idx = base_server_text.find(WRAPPER_MARKER)
    if idx < 0:
        raise SystemExit("base APK 的 server.js 里找不到 dpad 包装头标记，确认 base 是带遥控器适配的壳")
    head = base_server_text[: idx + len(WRAPPER_MARKER)]

    with open(standalone_server_path, encoding="utf-8") as f:
        server = f.read()
    if '"compress":true' in server:
        server = server.replace('"compress":true', '"compress":false')
    return head + "\n" + server


def patch_required_server_files(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("config", {})["compress"] = False
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def patch_version_name(manifest: bytes, version_name: str) -> bytes:
    """二进制 AXML 里等长替换 versionName（旧串长度必须一致，否则字符串池偏移会乱）。

    壳 APK 的资源是编译好的 resources.arsc / 二进制 AndroidManifest.xml，
    直接改字符串池里的等长字符串是零成本方案；长度不同就只能改壳工程重编。
    """
    if not version_name:
        return manifest

    # 找出 manifest 里所有形如 x.y.z-phone 的 UTF-16LE 字符串（AXML 字符串池实测为 UTF-16LE）
    candidate_re = rb"(?:\d\x00)+\.\x00(?:\d\x00)+\.\x00(?:\d\x00)+-\x00p\x00h\x00o\x00n\x00e\x00"
    candidates = []
    for match in re.finditer(candidate_re, manifest):
        s, e = match.start(), match.end()
        # 排除从数字串中间开始匹配的情况（例如 "2.21.0-phone" 里截到 "21.0-phone"）
        if s >= 2 and manifest[s - 1] == 0x00 and 0x30 <= manifest[s - 2] <= 0x39:
            continue
        candidates.append((match.group(0).decode("utf-16-le"), s, e))
    if not candidates:
        print("[warn] manifest 里没找到 x.y.z-phone 形式的 versionName，跳过版本号改写")
        return manifest

    old, s, e = candidates[0]
    if len(old) != len(version_name):
        print(f"[warn] 旧 versionName={old} 与新值 {version_name} 长度不同，跳过改写（请改 base APK 或重新编译 resources）")
        return manifest
    new_bytes = version_name.encode("utf-16-le")
    out = manifest[:s] + new_bytes + manifest[e:]
    print(f"[info] AndroidManifest versionName: {old} -> {version_name}")
    return out


def collect_nextbuild(standalone_dir: str) -> dict:
    root = os.path.join(standalone_dir, ".next")
    if not os.path.isdir(root):
        raise SystemExit(f"{root} 不存在，先跑 next build（standalone 输出）")
    patch_required_server_files(os.path.join(root, "required-server-files.json"))

    files = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "cache"]
        for name in filenames:
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, root).replace("\\", "/")
            if rel.startswith("cache/"):
                continue
            files[ASSET_PREFIX + "nextbuild/" + rel] = open(p, "rb").read()
    return files


def repack(base_apk: str, standalone_dir: str, out_path: str, version_name: str) -> str:
    zin = zipfile.ZipFile(base_apk, "r")
    try:
        base_server = zin.read(ASSET_PREFIX + "server.js").decode("utf-8")
        merge_target = os.path.join(standalone_dir, "server.js")
        merged_server = merge_server(base_server, merge_target).encode("utf-8")

        manifest = zin.read("AndroidManifest.xml")
        manifest = patch_version_name(manifest, version_name)

        replace = {
            "AndroidManifest.xml": manifest,
            ASSET_PREFIX + "server.js": merged_server,
            ASSET_PREFIX + "package.json": open(os.path.join(standalone_dir, "package.json"), "rb").read(),
        }
        new_nextbuild = collect_nextbuild(standalone_dir)
        print(f"[info] 新的 nextbuild 文件数 = {len(new_nextbuild)}")

        tmp_path = out_path + ".tmp"
        zout = zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True)
        keep = replaced = 0
        for info in zin.infolist():
            name = info.filename
            if name == "META-INF" or name.startswith("META-INF/"):
                continue  # 旧签名，行程完成后重新签
            if name.startswith(ASSET_PREFIX + "nextbuild/"):
                continue  # 旧构建产物整体丢弃
            data = replace[name] if name in replace else zin.read(name)
            replaced += 1 if name in replace else 0
            keep += 0 if name in replace else 1
            zi = zipfile.ZipInfo(name, date_time=info.date_time)
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            zi.compress_type = zipfile.ZIP_STORED if name in STORED_ENTRIES else info.compress_type
            zout.writestr(zi, data)

        for name in sorted(new_nextbuild):
            zi = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            zi.external_attr = 0o644 << 16
            zi.create_system = 3
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, new_nextbuild[name])
        zout.close()
    finally:
        zin.close()

    os.replace(tmp_path, out_path)
    print(f"[info] 重打包完成 keep={keep} replace={replaced} size={os.path.getsize(out_path)/1048576:.1f}MB")
    return out_path


def sign(apk: str, zipalign: str, apksigner: str, keystore: str, ks_pass: str, key_pass: str) -> None:
    tmpdir = tempfile.mkdtemp()
    aligned = os.path.join(tmpdir, "aligned.apk")
    subprocess.run([zipalign, "-f", "4", apk, aligned], check=True)
    final = apk.replace("-unsigned.apk", "").replace(".apk", "-signed.apk") if apk.endswith("-unsigned.apk") else apk
    signed = os.path.join(tmpdir, "signed.apk")
    subprocess.run([apksigner, "sign", "--ks", keystore, f"--ks-pass", f"pass:{ks_pass}",
                    f"--key-pass", f"pass:{key_pass}", "--out", signed, aligned], check=True)
    shutil.move(signed, final)
    subprocess.run([apksigner, "verify", "--print-certs", final], check=True)
    print(f"[info] 签名完成: {final}")
    shutil.rmtree(tmpdir, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="LibreTV 安卓壳 APK 重打包")
    ap.add_argument("--base-apk", required=True, help="带 dpad 遥控器适配的壳 APK")
    ap.add_argument("--standalone", required=True, help="next build 产出的 standalone 目录")
    ap.add_argument("--out", required=True, help="输出 APK 路径，建议以 -unsigned.apk 结尾")
    ap.add_argument("--version-name", default="", help="要写进 AndroidManifest 的 versionName，如 2.21.1-phone（与旧值等长）")
    ap.add_argument("--zipalign", default="", help="zipalign 可执行文件路径")
    ap.add_argument("--apksigner", default="", help="apksigner 可执行文件路径（Windows 上通常是 apksigner.bat）")
    ap.add_argument("--keystore", default="", help="签名 keystore 路径")
    ap.add_argument("--ks-pass", default="", help="keystore 密码")
    ap.add_argument("--key-pass", default="", help="key 密码")
    args = ap.parse_args()

    repack(args.base_apk, args.standalone, args.out, args.version_name)

    if args.zipalign and args.apksigner and args.keystore:
        sign(args.out, args.zipalign, args.apksigner, args.keystore, args.ks_pass, args.key_pass)
    else:
        print("[info] 未提供签名参数，只输出未签名 APK。后续手动执行 zipalign / apksigner。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
