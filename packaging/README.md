# 打包 / 发布说明

本仓库同时对应两种桌面/移动端形态，产物统一挂在 GitHub Release 上：

| 平台 | 产物 | 来源 | 说明 |
|---|---|---|---|
| 安卓 | `LibreTV-Android-vX.Y.Z-universal.apk` | **本仓库 `packaging/android/`** | nodejs-mobile 内置 Node 18.20.4 + Next standalone，离线可跑，支持电视遥控器 |
| Windows | `LibreTV-Windows-x.y.z-x64-setup.exe` / `.msi` | `iuczy8/libretv-app`（Tauri v2 壳）的 CI | 静态前端壳，体积小（3~5 MB） |
| 飞牛 fnOS | `libretv_X.Y.Z_x86_native.fpk` | 本地 fnpack 打包（standalone + node 运行时） | 走 NAS 上的服务端形态 |

## 安卓

详细步骤、校验清单和已知坑见 [`android/README.md`](android/README.md)。

```bash
DOCKER_BUILD=1 npm run build
python packaging/android/build_apk.py --base-apk <壳APK> --standalone .next/standalone \
  --out LibreTV-Android-v2.21.1-universal.apk --version-name 2.21.1-phone \
  --zipalign "$ANDROID_HOME/build-tools/35.0.0/zipalign" \
  --apksigner "$ANDROID_HOME/build-tools/35.0.0/apksigner" \
  --keystore libretv.keystore --ks-pass libretv123 --key-pass libretv123
```

要点：
- 签名密钥 `libretv.keystore` 必须长期保留，换钥匙 = 老用户无法覆盖安装。
- 壳 APK（带 dpad 遥控器适配）不在仓库里，需要单独保存；脚本靠它提供 `classes.dex`、`libnode.so`、`dpad.js`。
- `compress` 必须是 `false`，否则 dpad 注入会破坏 HTML。

## Windows

Windows 包由 Tauri 壳仓库 `gzk88/libretv-app`（fork 自 `iuczy8/libretv-app`）的
`.github/workflows/release.yml` 构建：`windows-latest` 上跑 `tauri-apps/tauri-action`，
产出 NSIS `*-setup.exe` 与 MSI，直接上传到该仓库的 Release。

想更新 Windows 端的界面，需要改的是那个 Tauri 仓库的 `public/`，不是本仓库的 `src/`。

## 发布流程

1. 代码合入 `main`，打 tag（`vX.Y.Z`）；
2. 构建安卓包、Windows 包；
3. 在 Releases 建对应 tag 的 Release，附件命名统一为
   `LibreTV-Android-vX.Y.Z-universal.apk`、`LibreTV-Windows-x.y.z-x64-setup.exe`、`LibreTV-Windows-x.y.z-x64.msi`；
4. Release 说明里写本期功能点和安装提示（安卓包可覆盖安装旧版）。
