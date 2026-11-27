# 安卓端打包说明（nodejs-mobile 壳 + Next standalone）

这套 APK 不是 Tauri 壳，也不是简单 WebView：**手机自己跑一个完整的 Next.js 服务端**，
WebView 打开 `http://127.0.0.1:8080`，所以断网也能用（只有片源搜索、豆瓣接口这些需要联网）。

- 包名：`com.libretv.app.phone`
- 版本名：`x.y.z-phone`（例如 `2.21.1-phone`）
- 运行时：nodejs-mobile 内置 Node **18.20.4**，ABI 三个（`arm64-v8a` / `armeabi-v7a` / `x86_64`）
- 遥控器适配：`assets/nodejs-project/server.js` 顶部的 dpad 注入包装器 + `assets/dpad.js`

## 1. APK 内部结构

```
AndroidManifest.xml        # 二进制 AXML，versionName 等
classes.dex                # 壳的 Activity（WebView + customView 全屏 + 启动 node）
lib/<abi>/libnode.so       # nodejs-mobile 的 Node 运行时
res/ resources.arsc        # 图标、应用名（LibreTV2.21）
assets/
├── dpad.js                # 电视遥控器方向键适配脚本（服务端注入到每个 HTML 页）
└── nodejs-project/
    ├── main.js             # 入口：nextbuild -> .next 改名、设 PORT/HOSTNAME、require server.js
    ├── server.js           # dpad 注入包装器 + Next standalone 的 server.js
    ├── package.json
    ├── nextbuild/          # 就是 Next 的 .next（AGP 排除点开头目录，所以改名）
    ├── node_modules/
    └── public/
```

`main.js` 在启动时把 `nextbuild` 改名成 `.next`，因此重新打包时**目录必须叫 nextbuild**。

## 2. 构建顺序

```bash
# 1) 构建 standalone（在 LibreTV 仓库根目录）
DOCKER_BUILD=1 npm run build        # 或者 npx next build，输出在 .next/standalone
# standalone 目录里应当有 server.js / package.json / .next / node_modules / public

# 2) 重打包（脚本会自动：合并 dpad 包装头、关 compress、替换 nextbuild、改 versionName）
python packaging/android/build_apk.py \
  --base-apk  LibreTV-2.21.0-shell.apk \
  --standalone .next/standalone \
  --out LibreTV-Android-v2.21.1-universal.apk \
  --version-name 2.21.1-phone \
  --zipalign  "$ANDROID_HOME/build-tools/35.0.0/zipalign" \
  --apksigner "$ANDROID_HOME/build-tools/35.0.0/apksigner" \
  --keystore libretv.keystore --ks-pass libretv123 --key-pass libretv123
```

Windows 上没有 `zipalign`/`apksigner` 的软链，可直接传 `.exe` / `.bat`：

```powershell
python packaging\android\build_apk.py `
  --base-apk  "C:\path\LibreTV-2.21.0-shell.apk" `
  --standalone "C:\path\.next\standalone" `
  --out "C:\path\LibreTV-Android-v2.21.1-universal.apk" `
  --version-name 2.21.1-phone `
  --zipalign "C:\Users\Kai\AppData\Local\Android\Sdk\build-tools\35.0.0\zipalign.exe" `
  --apksigner "C:\Users\Kai\AppData\Local\Android\Sdk\build-tools\35.0.0\apksigner.bat" `
  --keystore "C:\path\libretv.keystore" --ks-pass libretv123 --key-pass libretv123
```

只打包不签名（例如先检查体积/结构）：

```bash
python packaging/android/build_apk.py --base-apk shell.apk --standalone .next/standalone --out out-unsigned.apk
zipalign -f 4 out-unsigned.apk out-aligned.apk
apksigner sign --ks libretv.keystore --ks-pass pass:xxx --key-pass pass:xxx --out final.apk out-aligned.apk
```

## 3. 脚本改了什么（以及为什么）

| 动作 | 原因 |
|---|---|
| 合并 `server.js`：壳的 dpad 包装头 + 新 standalone 的 `server.js` | dpad 注入依赖 `http` 的 `writeHead/end` 打补丁，必须保留壳里那段 |
| `nextConfig.compress` 强制 `false`（`server.js` 与 `.next/required-server-files.json` 都改） | 开了 gzip 后响应体是压缩流，注入 `<script>` 会直接破坏页面 |
| `.next` → `nextbuild` | AGP 打包会排除以 `.` `_` 开头的目录 |
| 去掉 `META-INF/*` | 旧签名，签名阶段会重新生成 |
| `AndroidManifest.xml` / `classes.dex` / `resources.arsc` 保持 STORED | Android 11+ 要求 `resources.arsc` 不压缩且 4 字节对齐 |
| `versionName` 等长改写（UTF-16LE 字符串池） | 壳的 resources 是编译好的，等长替换不用重编；长度不同就得改壳工程重编 |

## 4. 签名（重要）

- 签名文件：`libretv.keystore`，storepass / keypass 均为 `libretv123`，别名默认，证书：
  - `CN=LibreTV, OU=Mobile, O=LibreTV, C=CN`
  - SHA-256：`855935736b541983dcb74a55c2bcc5881c710a1a15ebe358b81c15b890ed469f`
- **这个 keystore 必须长期留存**：换了密钥，旧版本就不能覆盖安装，只能卸载重装（本地数据会丢）。
- 包名 `com.libretv.app.phone` 与签名任一变化都会导致覆盖安装失败。

## 5. 出包后校验清单

```bash
# 1) 签名与证书
apksigner verify --print-certs LibreTV-Android-v2.21.1-universal.apk

# 2) 包名 / 版本名
aapt2 dump badging LibreTV-Android-v2.21.1-universal.apk | head -2
# package: name='com.libretv.app.phone' versionCode='1' versionName='2.21.1-phone'

# 3) zip 完整性 + 关键文件
python - <<'EOF'
import zipfile
z = zipfile.ZipFile("LibreTV-Android-v2.21.1-universal.apk")
print("zip_ok", z.testzip() is None, "entries", len(z.namelist()))
srv = z.read("assets/nodejs-project/server.js").decode()
print("dpad包装头", "结束 dpad 注入包装器" in srv, "APP_VERSION",
      srv.split('"APP_VERSION":"')[1][:8], "compress_false", '"compress":false' in srv)
print("nextbuild", len([n for n in z.namelist() if "assets/nodejs-project/nextbuild/" in n]))
EOF

# 4) 用 APK 里同样的 Node 版本本地跑一遍（验证运行时兼容）
curl -O https://nodejs.org/dist/v18.20.4/node-v18.20.4-linux-x64.tar.xz && tar -xf node-v18.20.4-linux-x64.tar.xz
PORT=8099 HOSTNAME=127.0.0.1 node-v18.20.4-linux-x64/bin/node server.js &
curl -s http://127.0.0.1:8099/api/status     # 期望 version = 当前版本
curl -s http://127.0.0.1:8099/ | grep -c __ltvDpad   # 期望 ≥1，说明 dpad 注入生效
```

## 6. 已知坑

- **Node 版本**：壳里是 18.20.4，Next 15 要求 ≥ 18.18，能用；如果以后升级 Next 到要求 Node 20+ 的版本，得先换壳的 `libnode.so`。
- **native 依赖**：standalone 的 `node_modules` 里带 `sharp`/`@next/swc` 的 glibc 二进制，安卓是 bionic，加载不了。当前 `images.unoptimized = true`，运行时不碰 `sharp`，所以没问题；如果开启图片优化就会直接崩。
- **体积**：`nextbuild` ≈ 5 MB、`node_modules` ≈ 63 MB，压缩后整包 ≈ 64 MB；改前端后包体基本不变。
- **不要动 `assets/nodejs-project` 之外的东西**（`classes.dex`、`res`、`libnode.so`），除非你明确要改壳。
- **首次安装/覆盖安装**：同签名同包名可直接覆盖；跨签名安装会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，需先卸载。
