# Folia 更新服务（自建）

一个单进程的 Node 服务：管理页上传 APK 与更新说明，Folia Android 启动后拉清单并弹窗提示。

## 启动（Windows 一键）

双击 `start.bat`：首次运行会自动装依赖、生成管理密码（存进 `admin-password.txt`），然后打印：

```
==========================================================
  Folia 更新面板：http://127.0.0.1:8787
  管理密码：xxxxxxxxxxxxxxxx
==========================================================
```

并自动打开浏览器面板。关闭窗口即停止；换端口用 `set PORT=8790` 再运行，或改 bat 里的默认值。

设了环境变量 `FOLIA_NO_BROWSER=1` 时不自动开浏览器（服务器上跑时用）。

## 启动（手动 / 非 Windows）

```powershell
cd tools/update-server
npm install
$env:ADMIN_PASSWORD='换成你自己的密码'
$env:PORT='8787'            # 可选，默认 8787
node server.js
```

浏览器打开 `http://127.0.0.1:8787` → 输密码 → 填 versionCode、版本名、更新内容、可选/强制 → 选 APK → 上传并发布。

数据都在本目录：`data/releases.json` 是清单，`data/apk/` 是安装包。备份这两个就够了。

## 让外网访问（穿透）

Android 只接受 HTTPS 下载，所以必须走带证书的穿透：

**Cloudflare Tunnel（免费、自动 HTTPS）**

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

命令会打印一个 `https://xxxx.trycloudflare.com` 地址；长期用请建命名隧道绑自己的域名。

**frp**：自备域名与证书，反代到 8787。

## 客户端怎么知道这个地址

构建前在仓库根目录的 `.env.local`（或 `.env.production`）里写：

```
VITE_UPDATE_ENDPOINT=https://xxxx.trycloudflare.com
```

然后照常 `npm run build:capacitor` + `npx cap sync android` + 打包。没配这个变量时，客户端整体不启用更新检查（不会报错，也不会请求）。

## 客户端行为

- 启动 5 秒后查一次，之后每 6 小时查一次（只在应用可见时）。
- 设置 → 通用 → 安卓设置里有「检查更新」手动入口。
- 服务端版本比本机新 → 弹窗；清单里 `mandatory=true` 或本机低于 `minSupportedVersionCode` → 强制，弹窗不可关闭。
- 「以后再说」只跳过这一版；点手动检查仍会提示。
- 下载完成 → 调系统安装器；没给「安装未知应用」权限时弹「去允许安装」。
- 服务器连不上时静默失败，只有手动检查会提示。

## 版本号怎么填

看 APK 自己的 versionCode（`android/app/build.gradle` 里的 `versionCode`），不是版本名里的三位数。发布时这个值必须**大于**线上已有的值，服务端会拒绝倒退。

## 安全

- 管理页只有一个密码（`ADMIN_PASSWORD`），会话是 HMAC 签名的 HttpOnly Cookie。
- 上传只收 `.apk`，上限 120MB，落在 `data/apk/`；清单里记录 SHA-256。
- 公开接口只有 `/api/update` 和 `/downloads/*`，其余都要登录。
- 穿透地址尽量别公开贴，密码别复用。
