# Folia for Android

Folia 的非官方 Android 移植版。工程完全内置。

## 当前结构

```text
Folia React/Vite 前端
  -> Capacitor Android WebView
  -> FoliaNativeBridge JavaScript 兼容层
  -> FoliaNative Capacitor 插件
  -> Android CookieManager / OkHttp
```

扩展中的 `api/folia.js`、网易云、QQ、酷狗适配代码已复制到：

```text
src/nativeBridge/api/
src/nativeBridge/vendor/
```

Android 启动时会在 `src/index.tsx` 安装原生桥，模拟浏览器扩展的 `chrome.cookies`、`chrome.storage`、网络请求和 `FOLIA_API_REQUEST` 消息协议。

## 构建环境

- Node.js 24
- JDK 21（Capacitor 8 的 source/target 级别是 21，必须用 JDK 21；工程里通过 `android/gradle.properties` 的 `org.gradle.java.home` 指定）
- Android Studio
- Android SDK 36.1
- Android Build Tools 36.x

本机已验证路径：

```text
JDK 21:      C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot
Android SDK: C:\Users\whycf\Android\Sdk
```

## 安装 JS 依赖

```powershell
npm install
```

## 构建网页产物

```powershell
$env:VITE_NETEASE_API_BASE='extension'
$env:VITE_QQ_API_BASE='extension'
$env:VITE_KUGOU_API_BASE='extension'
npm run build:capacitor
```

## 同步 Android 工程

```powershell
npx cap sync android
```

## 生成调试 APK

Windows：

```powershell
$env:ANDROID_HOME='C:\Users\whycf\Android\Sdk'
$env:ANDROID_SDK_ROOT='C:\Users\whycf\Android\Sdk'
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
cd android
.\gradlew.bat assembleDebug
```

APK 输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 当前实现范围

- Android Capacitor 容器
- 内置桥消息协议
- Android CookieManager 兼容层
- OkHttp 网络请求兼容层
- 网易云、QQ、酷狗 API 代码内置
- QQ 收藏、专辑、歌单逻辑保留
- 后台播放前台服务
- 锁屏和通知栏 MediaSession 控制
- Android MediaStore 本地音乐扫描
- App 内本地 HTTP 音频流

### QQ 写入接口的形状（合并上游时务必保留）

红心 / 取消红心的写入（`music.musicasset.PlaylistDetailWrite` 的 `AddSonglist` / `DelSonglist`）
在 QQ 官方服务端只认**下面这个组合**，缺任何一半都会被业务码拒掉。这是 2026-10 用「形状矩阵
自检」在现场矩阵里逐项试出来的，两条历史弯路各对了一半：

| 形状 | 结果 |
| --- | --- |
| android comm + 设备身份 + QIMEI + `uid/sid` 会话，**不带 g_tk** | 业务码 `500026` |
| **g_tk**（放 query）+ 网页 comm（`ct:24, uin`） | 业务码 `80105` |
| **android comm + 设备身份 + QIMEI + `uid/sid` 会话 + g_tk** | `retCode=0`，关系真的改变 |

实现集中在 `src/nativeBridge/api/qq.js` 的 `qqMusicassetWriteCall`：
android comm（`buildQQRadioComm`）+ `buildQQRadioCookie` 重建的凭据 cookie + `QQ_MUSICU_UA` +
`qqMusicRequest(..., { gTk: qqGtk(cookieHeader) })`。
`qqGtk` 只吃 `skey` / `p_skey`（缺省 5381）—— 拿 `qm_keyst` 算会得到错误的 g_tk。

写入一律靠**再读关系确认**（`SongFavRead/IsSongFanByMid`），上游自报成功不算数。
QQ 的同一套形状也用于专辑订阅与歌单写入。

## 构建状态

- `npm run build:capacitor` 已通过
- `npx cap sync android` 已通过
- `gradlew assembleDebug` 已通过，产出 `android/app/build/outputs/apk/debug/app-debug.apk`
- APK 包名 `top.izuna.foliamajor`，当前版本 `0.7.20-android.196`（`versionCode` 234），minSdk 24，targetSdk 36

## 尚未完成

- 正式签名和应用商店配置

网易云 / QQ / 酷狗登录与曲库、AI 主题配置、后台播放前台服务、锁屏与通知栏媒体控制、
本地音乐（系统文件管理导入 + 设备音乐库扫描）均已接入，详细改动见提交历史。

## GitHub Actions

上游带过来的工作流大多是桌面版和自建服务的发布流程，跟 Android 版无关，已从本 fork 移除：

```text
.github/workflows/canary-pre-release.yml
.github/workflows/docker-stack-check.yml
.github/workflows/docker-stack-publish.yml
.github/workflows/electron-release.yml
.github/workflows/nightly-pre-release.yml
.github/workflows/release-candidate.yml
.github/workflows/sync-server-docker-publish.yml
```

其中 `nightly-pre-release.yml` 是定时任务（每天 UTC 02:00），会在本仓库里构建并发布会往
Releases 里塞桌面版夜间包，所以优先删掉。

保留的两个：

- `codemap-sync.yml`：push 到 `main` 后自动重生成并提交 `docs/CODEMAP.md`
- `pr-unit-tests.yml`：push 和 PR 时跑前端单元测试

以后从上游合并时，如果上游又改了这些被删掉的工作流，冲突解决方式就是继续保持删除状态。

### QQ 登录通道：网页扫码优先、原生安卓兜底

`.176` 曾把 `qq` 通道换成原生安卓扫码（CreateQRCode + Login）来修红心写入被拒。但后续现场证据表明原生通道的 `musickey` 只是设备/登录密钥：同一账号**免费歌 purl=true、VIP 歌每档音质都 qqCode=104003 且 purl 为空**（账号确有会员、也重登过）。VIP 播放权挂在网页会话的授权 cookie（`p_skey`/`skey` 等）上，所以 `.194` 起 `login_qr_key` 改回**网页 ptlogin2 优先**，原生通道仅作回退。写入时的 `g_tk` 会来自 `p_skey`/`skey`，红心/收藏需重新回归验证 —— 合并上游时不要把这顺序改回去。

### QQ 音乐登录：不采用上游的新登录实现（2026-10-18 决定）

上游 0.7.20 之后改过一次 QQ 音乐登录。本仓**不采纳**：

- 继续用**网页扫码（ptlogin2）优先**，原生安卓扫码仅作回退；**不引入 QQ 音乐 APP 扫码登录**。
- 合并上游时，src/nativeBridge/api/folia.js 里 `login_qr_key` 的 `qq` 分支、以及
  `src/nativeBridge/api/qq-native-login.js` / `qq-mqtt.js` 保持本仓实现，不要被上游覆盖。
- 原因：网页凭证带 `p_skey`/`skey` 等授权 cookie，VIP 播放权挂在上面（`.194` 实测：换回网页
  扫码后部分 VIP 歌恢复 `purl=true`）；APP 扫码凭证只够写红心，不能覆盖 VIP 播放。

## 0.7.21 重移植（A 方案）

上游 v0.7.21 把 `src/services/onlineMusic/` 拆成按平台子目录（`bodian/ kugou/ netease/ qq/`）、
播放层拆到 `components/app/playback/{bridges,start}/`，直接 merge 0.7.20 旧树会产生数百个类型错误。
因此改为**以 v0.7.21 为底重建移植**：分支 `android-0.7.21` 从 `upstream/main` 起步，逐组把本仓的
Android 改动贴到新结构上。

已完成（按顺序）：

1. 基建：`npm install` 同步依赖；从 main 搬入「我们新增、上游没有」的 594 个文件
   （`src/nativeBridge/**`、`android/**`、Capacitor 配置、我们的测试与工具）
2. 清理：删除上游已迁移/已删除的 0.7.20 旧副本（共约 360 个）；`tsc` 从 688 错降到 0
3. 入口与壳：`index.tsx` 接原生桥/崩溃诊断/chunk 恢复/帧耗时采样/手机布局/屏幕常亮；
   `package.json` 合并 capacitor 依赖与 Android 脚本
4. 渲染：`IS_ANDROID_WEBVIEW` 探测、30 FPS 档与安卓默认 30、Diorama 暂停切 demand + 关 MSAA、
   Latent 暂停停帧（按上游重写后的 rAF 循环改造）
5. 诊断：自研的 `buildDiagnosticReport` 全量恢复（上游没有这个文件）+ 帮助页「复制诊断数据」+
   取流/失败留痕接回 `omni.getAudioSource` 与 `logOnlineFailure`
6. 运行时：所有在线音源统一走原生流代理、物理返回键、通用设置里的 Android 四件套
7. 本地音乐：设备扫描/导入动作、原生回环音频播放、封面取色经原生桥，全部嫁接到新 library 结构

已知差异（与我们的 .196 相比）：

- QQ 在 0.7.21 新增的接口（`recommend_new_*`、`radio_*`、`song_similar`、`user_vip`、
  `user_playlist_create`、`login_refresh`）未在我们的原生桥里实现 —— 这些是上游新功能，
  .196 时代不存在；对应页面在安卓上暂不可用，其余 QQ 功能（登录/搜索/歌单/收藏/播放）已覆盖。
- 桌面专用能力（Electron、模组系统、桌面更新检查等）按本仓惯例继续删除。

构建：`npm run build:capacitor` → `npx cap sync android` → `android/gradlew.bat assembleDebug`。
版本号从 `0.7.21-android.197`（versionCode 235）起。

### 重移植完成状态（0.7.21-android.197）

- 编译：`npx tsc --noEmit` 0 错误
- 测试：全量 871 个测试文件 / 9882 个用例通过（3 个跳过：Windows 符号链接一条、上游原本跳过两条）
- 构建：`npm run build:capacitor` → `npx cap sync android` → `gradlew assembleDebug` 全通过
- 已恢复的功能：原生桥（QQ/网易云/酷狗/波点直连）、QQ 网页扫码优先登录 + 资料缓存、酷狗写入判定
  与取消收藏重试/替代源、网易云 like 防假成功、播放诊断报告（含 online mutation / playback trace）、
  原生音频流代理、物理返回键、Android 设置四件套、本地音乐（MediaStore 扫描/导入 + 原生回环播放）、
  渲染优化（安卓关 MSAA、暂停切 demand、30FPS 档、Latent 暂停停帧）
- 真机待验证项：QQ 扫码登录、红心/收藏写入、VIP 歌曲播放、本地音乐扫描与播放、诊断报告复制

### 0.7.21-android.198：波点音乐在安卓上消失的修复

上游 0.7.21 把波点（Bodian）改成**桌面专用**：`bodian/bodianTransport.ts` 只认
`window.electron.bodianRequest`，安卓没有 Electron，可用性变成 `runtime-unavailable`，
而登录/平台列表把这类平台整行隐藏 —— 于是「波点音乐」在界面上不见了。

修复：transport 的可用性判定认 `IS_ANDROID_WEBVIEW`，请求走内置原生桥
（`requestFoliaExtension({ provider: 'bodian' })` → `nativeBridge/api/bodian.js`，与 .196 一致）。
新增回归测试：安卓壳里可用性必须是 `configured`。

### 0.7.21-android.200：功能自检与补齐（用户截图「封面灰蒙蒙」）

**封面灰蒙蒙的根因**：.196 的「性能优先」墙模式没被移植。0.7.21 上游没有这个模式，
于是墙面的 `.lattice-root::after` 噪点混合层、暗角、海报叠层与悬停滤镜一直挂着，
所有封面看起来像盖了一层灰白纱。

补齐清单（本轮）：
- 性能优先模式：store 字段（默认开）+ `wall.css` 整段 `.is-performance` + BravaisStage/Lattice 挂类
  + 设置 → 播放 → 墙面 的新开关（三份语言）
- P0 缺失模块 14 个恢复并接线：ColorOS 系统歌词、沉浸模式（收起/唤回/自动隐藏）、播放心跳、
  原生媒体动作、底部命令面板按钮、ChunkLoadBoundary、封面预热、网易云会话丢失、lumiere/tempera 手机默认值
- 诊断报告：复制 + 导出（FoliaNative.shareTextFile / Web Share / 下载回退）
- Android 设置改用 0.7.21 新控件（安卓外壳分组：自适应分辨率/全沉浸/屏幕常亮/手机适配/横竖屏/命令面板按钮）
- 安卓底部偏移一次性迁移；波点音乐接回内置桥
- 回归测试：两批共 27 个文件搬回，全量 871 文件 / 9971 用例通过

**待真机验证**：墙面封面颜色是否恢复正常（性能优先默认开时不该再有灰白纱）、ColorOS 锁屏歌词、
通知栏/耳机键控制、沉浸模式、诊断复制与导出。

### 自检结论与残余差异（.200 之后）

自检方式：`main`(.196) 相对基线 v0.7.20 的全部新增/修改文件逐项对照，并对 `android/`、
`src/nativeBridge/`、`package.json` 做内容级比较。结论：

- **`android/` 与 `src/nativeBridge/` 与 .196 一致**（仅版本号/一处迁移路径差异）
- 自检发现的 P0 缺口已全部补齐并接线；P1（性能优先、封面预热、手机默认值）已补
- **有意保留的差异**：
  1. QQ 在 0.7.21 新增的接口（`recommend_new_*`、`radio_*`、`song_similar`、`user_vip`、
     `user_playlist_create`、`login_refresh`）原生桥未实现 —— 这是上游新增功能，.196 时代不存在
  2. AI 主题：0.7.21 上游改成了服务端路由架构（`/api/theme` 由部署方提供环境变量），
     Android 没有这个服务端，与 .196 一样不可用；.196 的 `aiThemeClient/gemini` 直连架构
     与上游新架构不兼容，未强行移植
  3. ColorOS 歌词没有手动开关（上游设计为检测到 ColorOS 16+ 自动启用），设置页只缺一行
     状态说明，功能本身已接线
- 回归测试搬回 27 个文件；全量 871 文件 / 9971 用例通过（3 跳过：Windows 符号链接 + 上游原有）

### 0.7.21-android.202：修改文件的自检（第二轮，找回丢失改动）

第一轮只对照了「新增文件」；这轮把 main(.196) 相对基线的 **159 个修改文件**逐行对照
（提取我们加的行，按标识符在分支文件里的命中率找缺失），找回并修复：

- 视频层本地视频持久化：重启后不用重选（videoLayerFile 整份存缓存表 + store 接回 +
  `VIDEO_LAYER_FILE_BLOB_KEY`，清除缓存跳过它），回归测试搬回
- 网易云掉登录二次确认：接到 0.7.21 新的账号读取路径；实现方式是 `OnlineAuthProvider`
  的可选能力 `confirmSessionLoss`，不在 accountRead 里硬编码平台名
- 晶格歌词建行/建片分帧预算：`createLatticeLyricRuntime` + `latticeLyricScene`
  （现场 LOAF 198ms 的卡顿修复）
- 音频效果链中性效果旁路
- 性能优先模式的 JS 部分：PosterWall overscan 500→140、相机最多预留一屏；useBravaisCamera 同步
- 播放失败诊断留痕：取流冷却/失败、媒体阶段错误（报告里能对上「只有一条 ok 却放不了」）
- 底部播放胶囊触摸修复（上一轮已单独提交）

**有意不搬的（架构已变，另有替代）**：
- 0.7.21 把登录窗口/账号/歌词/播放队列重写过，`.196` 在这些文件里的诊断留痕（lyrics 形状、
  队列加载、App 音频元素事件）落点已不存在；新的统一登录窗口自带失败诊断复制入口
- AI 主题（服务端路由架构）与 gemini 直连不兼容，维持「安卓不可用」
- `SettingsHelpActions` 的「删除诊断」按钮没搬（复制/导出已有）

全量测试：871 文件 + 新增测试，9975+ 用例通过；tsc 0 错。

### 0.7.21-android.203：Spotify 接入（继续做） + YouTube Music 入口

**YouTube Music：只做入口**
- Android 上平台可见、可进登录窗口，说明文案写明「仅入口，功能未实现」；任何请求报 unsupported

**Spotify：登录 + 读取/写入链路（本轮完成）**
- 原生 `SpotifyAuth.java`：OAuth 授权码 + PKCE，固定回环 `127.0.0.1:5588/login`（与桌面同一个
  client id），系统浏览器登录、回环接回调、令牌自动刷新、存应用私有 SharedPreferences
- `FoliaNativePlugin`：spotifyStartLogin / spotifyCancelLogin / spotifyLoginStatus / spotifyLogout /
  spotifyAccessToken / spotifyRequest
- `nativeBridge/api/spotify.js`：移植桌面桥的 pathfinder 查询与 CHANGES 写入（喜欢、歌单增删、
  新建歌单），读歌单整表再精确增删；radio/lyrics 走 spclient；音频三操作明确 unsupported
- `folia.js` 路由 + fetch 白名单（spotify.com / spotifycdn.com / scdn.co）
- `spotifyTransport` Android 走内置桥；`spotifyProvider` Android 上关闭 playback 能力

**待办**
- 真机验证登录（系统浏览器 → 回调 → 回到 App 后平台显示已登录、歌单/喜欢可读）
- Android 播放：暂关闭完整播放（无 librespot）；计划用 30 秒 preview_url 试听
### 0.7.22 同步（android-0.7.22）与汽水音乐安卓移植

上游 v0.7.22（tag `v0.7.22`）已合并进 `android-0.7.22` 分支（合并提交记录了 18 个冲突的处理：
网易云登录态改用上游新版 `getLoginStatus`/`signInRanOut`，QQ 保留资料缓存并并入
`signedOutUnlessStoreUnreadable`，书库首页保留安卓设备扫描，Bravais 保留探索诊断，
AI 合并上游模型发现/预设接口并保留安卓直连运行时；`package-lock` 采用上游后重新 `npm install`）。

汽水音乐（qishui）是 v0.7.22 新增平台，上游实现**只跑 Electron 主进程**：
`src/services/onlineMusic/qishui/qishuiTransport.ts` 只认 `window.electron.qishuiRequest`，
协议包 `qishui-music-api@0.2.2` 用 `node:crypto`（P-256 生成/签名、PKCS#10 CSR、MD5）与 `Buffer`，
`<audio crossOrigin>` 依赖主进程 `mediaCors` 重写 CORS。安卓（Capacitor WebView）没有这些，
按波点（bodian）同构方案移植：

1. **`src/nativeBridge/api/qishui.js`（新增，约 1200 行）**
   - `qishui-music-api@0.2.2` 全部 25 个 operation 的浏览器移植：
     `login_status/logout/login_qr_key/create/check/cancel`、搜索/歌单/歌曲/歌词/艺人、
     `feed/feed_modes`、`liked_songs/like_song/...`、`recent_played/check_tracks/dislike_song`
   - `node:crypto` 全部替换：P-256 用 WebCrypto（`https://localhost` 是安全上下文），
     ECDSA raw `r||s` 转 DER、PKCS#10 CSR 用 Uint8Array 手工拼（与原 Buffer 实现逐字节一致）；
     MD5 常量硬编码；`randomBytes/randomUUID` 用 WebCrypto
   - 会话/设备号存 localStorage（`qishuiDeviceId`、`qishuiSessionV1`），revision 变化时清
     feed 队列与歌单游标缓存；错误契约与桌面桥一致（`ok/error{code,message,stage,upstreamCode}`）
   - 出口 `handleQishuiRequest`，由 `src/nativeBridge/api/folia.js` 分发（在 netease 兜底之前）
2. **传输层**：`qishuiTransport.ts` 的可用性判定接受 `IS_ANDROID_WEBVIEW`；安卓分支走
   `requestFoliaExtension({ provider:'qishui' })`（`FoliaBridgeProvider` 加 `'qishui'`）；
   桥通道失败在 `qishuiFailure.ts` 映射为 `local-service-stopped`
3. **原生 HTTP**：汽水接口无 ACAO 且要求 `LunaOpenSDK/1.0.10` UA → 走
   `FoliaNative.httpRequest`（OkHttp）。`nativeAndroidBridge.ts` 的 `API_HOSTS` 加
   qishui/douyin/bytedance/volc/byte 等主机；`credentials:'omit'` 时向 Java 传
   `sendCookies:false`（对齐桌面桥不带 cookie）
4. **原生媒体**：`LocalAudioServer.java` 的远端音频白名单加 17 条字节/汽水 CDN 后缀
   （douyinvod / bytefcdn / zjcdn / snssdk 等），`refererForHost()` 对字节族发
   `https://music.douyin.com/`（UA 仍为移动 Chrome，不发 LunaOpenSDK）；
   `FoliaNativePlugin.registerRemoteAudio` 支持可选 `headers`（显式头优先）；
   顺带修了既有 206+chunked 场景 `Content-Length` 用 total 导致播放器卡住的边界问题
5. **测试**：新增 `test/unit/qishui/androidAvailability.test.ts`、
   `test/unit/qishui/protocolPort.test.ts`（DER/CSR/常量/session/错误包装）；
   `platformNamePlaces.ts` 登记 qishui 计数

**已知边界/风险（真机需验证）**
- CSR/PKCS#10 由 WebCrypto 生成，结构与协议包逐字节一致，但服务端是否接受只能在真机确认
- `bd-ticket-guard-server-data` 依赖 OkHttp 原样回传，再由 fetch shim 复制进 `Response.headers`
- `AbortSignal.timeout` 对 shim 不生效，实际超时由 shim `foliaTimeoutMs` + Java `timeoutMs` 兜底；
  `redirect:'error'` 在 Java 侧退化为 follow
- 会话目前是 localStorage 明文（与波点 token 同级）；后续可换 Android Keystore 加密
- 加密音频协议只回 `unsupported`（映射 `no-audio`），这是协议边界
- 汽水 CDN 是否校验 Referer/UA、是否 302 到白名单外主机，需真机抓包确认

构建：`npm run build:capacitor` → `npx cap sync android` → `android/gradlew.bat assembleDebug`。
版本 `0.7.22-android.272`（versionCode 310）。

### 0.7.22-android.273：汽水「我喜欢」只显示一首歌的修复

车机协议里「我喜欢」是 `type=1` 的歌单：读它的曲目时必须带 `type: 1`，否则
`/playlist/detail/` 只回一条（看到的封面是最新一首、打开只有一首歌）。桌面桥的
`playlist_tracks` 固定传 `type: null`，安卓桥补了 `liked` 标记：

- `qishuiCatalog.getPlaylistTracks/getPlaylistDetail`：`collection.isLiked === true` 时
  多传 `liked: true`（桌面端该字段被上游包忽略，行为不变）
- 安卓桥 `playlist_tracks`：`liked=true` 时 `playlistPage` 的 `type` 传 1，游标缓存 key
  也带 type，避免和普通歌单共用
- 桥内新增 `qishui:bridge:request` / `qishui:bridge:result` 留痕（search 条目数、
  liked_songs ids 数、playlist_tracks 条目数、audio 主机等），诊断报告可直接看到车机接口返回了什么
- 回归测试：`test/unit/qishui/likedPlaylistTracks.test.ts`

### 0.7.22-android.279：回退原生播放模块

- 按用户要求回退到 0.7.22-android.275 的实现：移除 ExoPlayer 原生播放、原生 DSP、原生频谱与原生媒体缓存，全部回到 <audio> + Web Audio。
- 版本号仍前进到 0.279 / versionCode 317，保证已安装 0.278 的设备可以正常覆盖升级。

### 0.7.22-android.280：automix 过渡期冻结 latent 音频脉动

- latent 背景的节奏脉动在 automix 可听过渡期间保持当前速度，settle 后再交回新歌；
  避免两条 deck 的 analyser 能量叠加造成背景抽动/闪烁（同一首歌重复过渡同样生效）。
- 不改智能动感模式本身，也不改音频输出。

### 0.7.22-android.281：修复酷狗扫码登录被非 ASCII Cookie 打断

- OkHttp 拒绝 Cookie 头里的非 ASCII 字符（真机报 `Unexpected char 0x5fb5 at 414 in Cookie value`），
  而 WebView 的 cookie 罐可能存着带中文的 cookie。
- FoliaNative.httpRequest 在发送前把 Cookie 值按 UTF-8 百分号编码，非法 cookie 名丢弃；
  显式 Cookie 头和 WebView 自动补的 Cookie 都走同一套清洗。
- 补 Java 单测覆盖中文值、空格和非法名字。

### 0.7.24-android.282：同步上游 v0.7.24

- 合并上游 0.7.24（含町景/雾笺/花火等歌词样式、HiFi 信号路径、音量平衡、YTM 等更新）。
- 保留 Android 适配：底部命令面板按钮、手机适配布局标记、原生桥、酷狗 Cookie 清洗、酷狗歌手解析、latent 过渡脉动保护。
- 版本 0.7.24-android.282 / versionCode 320。

### 0.7.24-android.283：雾笺性能优化

- 安卓壳把雾笺限制在 30fps，并把默认像素比压到约 0.65 倍，避免高 DPI 全屏雾/玻璃着色器把 GPU 占满；渲染分辨率设置仍可调高。
- 笔迹、水痕、雨点改用当前 Canvas 路径描边，去掉每帧大量 Path2D 分配。

### 0.7.24-android.284：雾笺继续降单帧成本

- 去掉安卓 30fps 限制。
- 安卓默认像素比约 0.5 倍；遮罩分辨率 0.5→0.42。
- 字迹描边三层→两层，水痕/雨点/擦痕单层；水痕段距 4→8 像素。
- 写完的笔画整条路径缓存，每帧不再重建。

### 0.7.25-android.285：同步上游 v0.7.25 雾笺性能优化

- 合并上游 v0.7.25：雾笺擦痕遮罩改 WebGL2、楼群缓存、雾 1/8 预渲染、静态噪声纹理、着色器拆分与预热等。
- 采用上游的 `NebbiaSegments` 遮罩实现，移除本分支临时的 Canvas 描边优化。
- 保留安卓适配与之前的酷狗/布局修复。

### 0.7.25-android.286：汽水加密音频解密代理

- 移植 sonnet 分支的 `QishuiAudioDecryptor` / `QishuiAudioServer`：spade_a 还原、AES-CTR、mp4/flac 解包，按 Range 本地回环输出。
- 新增 `FoliaQishuiAudio` 插件；汽水 `audio` 解析遇到带 spade_a/PlayAuth 的加密完整音源时，先尝试解密代理，失败再退回试听片段。
- 不改变免费/明文音源的原有路径。

### 0.7.25-android.287：播放诊断补歌名

- `online playback trace` 每条记录新增 `song=标题 - 歌手`，覆盖取流失败、媒体失败、omni 解析与代理失败。
- 反馈时能直接看到失败/成功的是哪首歌，不用再猜。

### 0.7.25-android.288：安卓端 Beat This! / HTDemucs 模型

- 模型权重（beat_this-wgsl.bin、htdemucs-wgsl.bin）随 APK 打包，构建时从根 models/ 复制。
- 新增 FoliaAnalysisModels 插件与本地回环模型服务，供 WebGPU 运行时读取。
- modelAvailability、智能动感可用性、鼓点/分轨检查接入安卓模型桥。

### 0.7.25-android.289：模型改为按需下载

- APK 不再内置 Beat This! / HTDemucs 权重，体积回到约 27MB。
- 设置 → 通用 → 安卓外壳新增模型管理：下载、进度、删除；镜像优先，GitHub 最后。
- 下载完成校验 SHA-256；模型落在私有目录，运行时经本地回环读取。

### 0.7.25-android.290：模型下载镜像修正

- hf-mirror / huggingface / AZURE 对这两个文件已 404/超时；改为 ghproxy.net → gh-proxy.com → GitHub 直连。
- 第一个镜像先用 Range 验证，再整份下载并校验 SHA-256。

### 0.7.25-android.291：模型检测与重试

- 模型行增加「检测」：校验字节数与 SHA-256，显示通过/文件不完整。
- 下载失败后按钮变「重试」；重试强制重新下载。
- UI busy 与原生 downloading 集合双重防重复下载。

### 0.7.25-android.292：雾笺笔画粘连修正

- 笔画最小宽度从 8 CSS 像素降到 1.5；原来 40px 字号下下限等于 0.2em，盖过 strokeWidth，密集笔画会叠成一团。

### 0.7.25-android.293：模型下载合并、删除移到存储

- 安卓外壳里两个模型合成一行，一个按钮依次下载 Beat This! 与 HTDemucs；保留检测/重试。
- 删除入口移到「存储」页，一次删除两个模型。

### 0.7.25-android.294：模型下载状态恢复

- 原生记录每个模型的下载中状态与百分比；页面切走再回来会恢复进度，而不是显示重新下载。
- 组件轮询 status，下载结束后刷新模型可用性。

### 0.7.25-android.295：嵌入背景支持自定义图片

- 「嵌入背景」可上传一张本地静态图片，压到最长边 1920px 的 JPEG 后存 localStorage。
- 图片作为独立条目参与选择；重复上传只保留一张，可在网页与图片之间切换。

### 0.7.25-android.296：旧 WebView 底栏居中修复

- Tailwind v4 的 -translate-x-1/2 编译成独立 translate 属性，Chrome 99 不认，底栏偏右。
- 底栏定位层改内联 transform: translateX(-50%)。

### 0.7.25-android.297：模型本地导入

- 安卓外壳的模型行新增「本地导入」，系统文件选择器可一次选一个或两个 .bin。
- 导入时校验字节数与 SHA-256，匹配才写入；不匹配不会覆盖现有模型。

### 0.7.25-android.298：模型 ZIP 导入

- 本地导入同时支持单个 .bin 与包含两个模型的 .zip；ZIP 内逐条校验 SHA-256。
- 输出 Folia-Analysis-Models.zip，一次选择导入两个模型。

### 0.7.25-android.299：启动图压缩

- 26 张 splash PNG（约 21.4MB）转为 WebP，约 0.32MB；APK 体积下降约 21MB。

### 0.7.25-android.300：QQ VIP 播放授权识别

- 区分「快速/微信登录缺少 p_skey/skey」与真正版权限制；前者返回 login_required 并引导重新用 QQ 扫码。
- vkey trace 增加 webAuth 字段。

### 0.7.25-android.301：QQ 登录提示修正

- 缺少 p_skey/skey 时明确说明是 QQ 登录未拿到网页播放授权，不再误指微信。

### 0.7.25-android.302：禁用 QQ 原生快速登录降级

- QQ 网页扫码失败时不再降级到原生通道；原生通道缺少 p_skey/skey，VIP 歌必回 104003。
- 失败直接提示重试，避免生成「能登录但不能播 VIP」的会话。

### 0.7.25-android.303：客户端模组系统（Android）

- 新增 FoliaMods 原生宿主：zip 导入、删除、启用状态、内容摘要与本地 HTTP 文件服务。
- 带 main（Node 主进程）入口的模组在导入时直接拒绝并提示不兼容。
- 设置 → 模组 在 Android 上显示客户端模组列表，可导入、启用、禁用、删除；启用后由 clientLoader 注册。

### 0.7.25-android.304：模组页恢复桌面配置

- Android 模组页不再使用简化版，改回桌面 ModManager：总开关、列表、批量启用、日志、每模组设置与详情都保留。
- Android 工具栏增加 ZIP 导入；main 模组导入时仍提示不兼容。

### 0.7.25-android.305：模组总开关与 ZIP 选择

- 模组总开关关闭时不返回列表，clientLoader 不启动任何模组代码。
- ZIP 选择器改为 */*，避免部分文件管理器把 zip 标成 x-zip-compressed 时选不到。

### 0.7.25-android.306：模组 net.fetch/存储适配

- 客户端模组的 net.fetch 走 FoliaNative.httpRequest，绕过 WebView CORS；filesystem.data / secret 用本地存储桥。
- Android 模组管理去掉拖放 ZIP 安装与打开目录按钮，保留工具栏 ZIP 导入。
- 歌曲资料等依赖 net.fetch 的客户端模组可正常查询。

### 0.7.25-android.307：模组分辨率保护开关

- 模组系统开关下新增「模组分辨率保护」，只把模组挂载 canvas 的绘制分辨率压到 75%，不限制帧率。
- 只处理 [data-folium-owner] 容器（含 ShadowRoot），内置歌词动画不受影响。

### 0.7.25-android.308：分辨率保护修正

- 保护只对模组 canvas 压一次，避免重复缩放；只对 Android 生效。

### 0.7.25-android.309：重新打开保护时重新扫描

- 关闭期间模组可能把画布改回全分辨率；再次打开时重新扫描现有 canvas。

### 0.7.25-android.310：模组常用库映射

- index.html 的 import map 补 pixi.js / three / opencc-js，供裸导入这些库的模组使用；自带 vendor 的模组不受影响。

### 0.7.25-android.311：模组分辨率保护 50% 与诊断

- 模组 canvas 分辨率压到 50%，并在诊断里输出开关状态、倍率和已处理画布数。

### 0.7.25-android.312：修复模组画布识别

- 之前只检查 canvas 自身和 ShadowRoot host，漏掉普通 DOM 祖先上的 data-folium-owner，导致 canvases=0。
- 现在沿 parentElement 向上查找，动感波光等 canvas 会被正确压缩。

### 0.7.25-android.313：分辨率三挡位

- 模组分辨率保护增加轻度 75% / 均衡 50% / 强力 35% 三挡；切换时按比例重设已有模组画布。

### 0.7.25-android.314：同一开关统一性能优化

- 三挡同时控制画布分辨率与模组 DOM 特效：轻度 75%、均衡 50% + 去阴影、强力 35% + 去 filter/blend。
- 补 pushRuntimeSnapshot 桥，消掉 Android 上的 unhandled rejection。

### 0.7.25-android.315：QQ 播放文件名与 UrlGetVkey

- vkey 文件名改成两段式 prefix + songmid + media_mid + 扩展名。
- 增加 music.vkey.GetVkey / UrlGetVkey 形态，并在 android 兜底里也试一次。

### 0.7.25-android.316：QQ UrlGetVkey 用音乐账号 id

- UrlGetVkey 的 uin 改用 str_musicid/musicid；comm 带 qq；诊断记录 hasMusicId。

### 0.7.25-android.317：QQ android comm 补 authst

- UrlGetVkey 的 android comm 同步带 musickey(authst)、qq、tmeLoginType。

### 0.7.25-android.318：QQ 只保留网页 vkey

- 删除 vkey 的 android 设备身份兜底，只保留网页登录的 CgiGetVkey/UrlGetVkey 形态。

### 0.7.25-android.319：恢复 android vkey 兜底供测试

- 恢复 CgiGetVkey/UrlGetVkey 的 android 设备 comm（带 qq/authst/tmeLoginType）；登录仍只走网页。

### 0.7.25-android.320：QQ 无音频给重新登录入口

- QQ 无音频提示改成「QQ 登录状态可能已失效」，并带登录按钮直接打开 QQ 登录窗口。

### 0.7.25-android.321：撤销 QQ 登录失效提示

- 无法区分会话失效与单曲无权限，去掉 QQ 无音频的重新登录提示，避免误判。

### 0.7.25-android.322：原生播放舞台实验（方案二）

- 新增 FoliaNativeStage 原生 View，放在 WebView 后面绘制渐变背景和当前/下一句歌词。
- 设置 → Android 外壳增加「原生播放舞台（实验）」开关，默认关闭；关闭立即移除原生 View 并恢复 WebView。
- 现有控件、设置、模组全部保留。

### 0.7.25-android.324：原生舞台性能优化

- 渐变/Paint/StaticLayout 按尺寸和歌词缓存，不再每帧新建。
- 原生舞台限制 60fps；暂停/窗口不可见时停止 Choreographer。
- 原生插件所有 View 操作切到 UI 线程。

### 0.7.25-android.325：原生舞台 SurfaceView

- 原生舞台改用 SurfaceView + 独立渲染线程，绘制不再占用 UI 线程。
- 渐变/StaticLayout 继续缓存；无变化时休眠。

### 0.7.25-android.326：原生舞台音频响应

- JS 以 20Hz 推送 audioPower/bass/mid/treble，原生 SurfaceView 画频谱条和发光脉冲。

### 0.7.25-android.327：原生底部控制条

- 原生 SurfaceView 上方增加底部控制条：上一首/播放暂停/下一首。
- 原生控制条通过 plugin 事件调用 WebView 的播放动作；开启原生舞台时隐藏 WebView 底部控件。

### 0.7.25-android.328：原生控制条进度与拖动

- 原生控制条绘制播放进度线，拖动进度区域调用 seekMainAudio。

### 0.7.25-android.329：原生歌词扫光

- 原生舞台按当前行开始/结束时间绘制歌词扫光。

### 0.7.25-android.330：原生粒子系统

- SurfaceView 预分配 64 个粒子，按音频能量生成，独立线程更新/绘制。

### 0.7.25-android.331：原生控制条主题色与安全区

- 控制条进度使用当前 accent；按系统手势/导航栏 inset 上移。

### 0.7.25-android.332：原生逐字歌词

- JS 推送当前行 words 和播放位置，原生按 word.startTime 点亮。
- 长行/宽度超出时回退到逐行扫光。

### 0.7.25-android.333：逐字插值

- 原生逐字按 word 起止时间平滑提高透明度，而不是到点瞬间点亮。

### 0.7.25-android.334：控制条横竖屏布局

- 控制条最大宽度 420dp 居中，横屏不再拉满；按钮/进度按实际胶囊矩形定位。

### 0.7.25-android.335：原生舞台主题色联动

- App 把当前 theme.accentColor 同步给原生舞台；渐变、粒子、控制条进度使用真实主题色。

### 0.7.25-android.336：原生舞台完整主题色

- 原生背景使用 theme.background/primary/secondary，发光与粒子使用 accent。

### 0.7.25-android.337：原生舞台诊断

- 诊断报告输出 native stage enabled/active/renderer/frames，便于确认真机是否真的在原生渲染。

### 0.7.25-android.338：原生舞台无帧自动回退

- 开启后 3 秒内 SurfaceView 没有出帧且处于播放状态，自动移除原生舞台并关闭开关，回到 WebView。

### 0.7.25-android.339：原生舞台 120fps 上限

- 帧间隔从 16ms 改为 8ms，按帧耗时补偿，最高 120fps。

### 0.7.25-android.340：修复原生舞台白屏/控制条样式

- 原生舞台无帧回退不再要求播放状态，暂停时 SurfaceView 不出帧也会回退。
- 暂不启用原生控制条，恢复 WebView 原有控制条与交互，避免黑色控制条和控件失效。
- 原生文字/控制条支持日夜主题。

### 0.7.25-android.341：白屏兜底

- 启用原生舞台成功后才给 WebView 加透明/隐藏视觉层样式。
- 原生插件 inactive 超过 3.5 秒，强制移除样式并关闭开关。
- fallback 事件先恢复 WebView 样式，再关闭开关。

### 0.7.25-android.342：修复原生舞台被启动保护误拒

- 根因：崩溃保护把上次 ACTIVE 当成不安全，整个进程内所有 enable 都被拒绝，舞台永远 active=false。
- 启动只清理 ACTIVE，不再拒绝本次启用。
- 诊断增加 surface/playing。

### 0.7.25-android.343：修复 SurfaceView 被窗口背景盖住

- 原生舞台启用时把 Activity 窗口背景设透明，关闭/回退时恢复。
- HTML 根节点也设透明；解决 active=true/surface=true/frames>0 但仍白屏。

### 0.7.25-android.344：原生舞台改 TextureView

- 根因：SurfaceView 在 OnePlus/Android 17 上被窗口层盖住，窗口透明 hack 仍无法显示。
- 改用 TextureView，普通 View 与 WebView 同窗口合成；独立渲染线程 lockCanvas。

### 0.7.25-android.345：TextureView 直接用 Surface 锁画布

- 不再用 TextureView.lockCanvas，改为 new Surface(surfaceTexture).lockCanvas。
- 解决 TextureView 渲染线程不出帧导致自动关闭。

### 0.7.25-android.346：原生舞台回退到 Canvas View

- TextureView 在该机仍不出帧；改用普通 View + Choreographer，保证与 WebView 同层可见。
- 120fps 上限；暂不绘制频谱/逐字，先保证原生画面可见。

### 0.7.25-android.347：修复浅色主题原生舞台整片白

- 原生舞台背景不再直接使用浅色主题背景；亮色背景钳制为暗色基底。
- 文字颜色按舞台实际底色计算，避免白底白字。

### 0.7.25-android.348：修复 AppShell 白底盖住原生舞台

- AppShell 的 inline background 是最后一层白底；原生舞台开启时透明化 data-folia-app-shell。

### 0.7.25-android.349：Canvas 舞台补回频谱/粒子/逐字

- Canvas View 接入 audioPower/bass/mid/treble，绘制频谱条和发光脉冲。
- 预分配 64 粒子。
- 解析 words，宽度允许时逐字点亮，否则回退逐行扫光。

### 0.7.25-android.350：原生场景协议 + Still 1:1

- 桥接 visualizerMode、前后行、翻译到原生。
- Canvas 原生舞台按 mode 分支；首个移植 still。

### 0.7.25-android.351：Classic 原生基础

- 新增 classic 模式：逐词布局、缩放、旋转、呼吸浮动、按时间点亮。
- 仍缺 GlowWord 的完整 glow/ripple/副字幕细节，继续补。

### 0.7.25-android.352：Classic glow 与翻译

- Classic 当前词加 shadow glow；行翻译居中显示。

### 0.7.25-android.353：Classic 逐字素

- 桥接 grapheme 时间；classic 逐字素绘制、透明度和缩放。

### 0.7.25-android.354：Classic chorus ripple

- 桥接 isChorus；原生当前词绘制扩散圆环。

### 0.7.25-android.355：Partita 基础

- 新增 partita 模式：当前行按行分块，垂直堆叠、交错偏移、逐词点亮。

### 0.7.25-android.356：Cappella 基础

- 新增 cappella 模式：前后中三条聊天气泡、翻译、左右对齐。

### 0.7.25-android.357：Cappella 头像

- 气泡左右头像、当前行右侧头像、标题首字。

### 0.7.25-android.358：Partita 辅助线

- partita 行间绘制淡辅助线。

### 0.7.25-android.359：Vulkan 渲染骨架

- 安装 NDK/CMake，arm64-v8a。
- 新增 FoliaVulkanStageView + libfolia_vulkan：Vulkan instance/device/swapchain/render pass/clear。
- 当前未替换 Canvas 舞台，仅完成 Vulkan 后端可构建验证。

### 0.7.25-android.360：Vulkan 动态 clear

- 每帧重录 render pass clear，按时间做暗色呼吸。

### 0.7.25-android.361：Vulkan 全屏 shader

- 增加 SPIR-V 全屏 triangle + 渐变/glow fragment shader。
- pipeline/push constant 构建成功；仍只用于后端验证。

### 0.7.25-android.362：Vulkan 文字纹理管线

- 增加 text.frag、descriptor set、sampler、texture、text pipeline。
- 支持从 Bitmap 上传 RGBA 并全屏采样；仍未替换 Canvas 舞台。

### 0.7.25-android.363：舞台切 Vulkan

- FoliaNativeStagePlugin 改用 FoliaVulkanStageView。
- 歌词用 Bitmap 纹理上传；Vulkan 背景 shader + 文字纹理。
- 不做 GLES/Canvas 回退。

### 0.7.25-android.364：Vulkan 诊断

- 诊断输出 vulkan ready 状态。

### 0.7.25-android.365：Vulkan 主题色

- JNI nativeSetAccent；shader push constant 使用当前 accent。

### 0.7.25-android.366：Vulkan 程序化粒子

- stage.frag 增加 18 个 GPU 粒子，随 time/accent 运动。

### 0.7.25-android.367：Vulkan 音频能量

- JNI nativeSetPower；push constant 增加 power，glow/粒子亮度随 audioPower。

### 0.7.25-android.368：Vulkan 纹理承接 Canvas 效果

- FoliaVulkanStageView 持有 Canvas 舞台，离屏绘制到 Bitmap 后上传 Vulkan 纹理。
- still/classic/partita/cappella 现有 Canvas 效果进入 Vulkan 输出。

### 0.7.25-android.369：Vulkan 帧循环纹理

- Canvas 舞台每帧重绘到复用 Bitmap，再上传 Vulkan。
- 效果开始随时间/音频更新，不再只在换行时刷新。

### 0.7.25-android.370：Vulkan Canvas 帧耗时诊断

- 统计每帧 Canvas 绘制+纹理上传耗时，诊断输出 canvasMs。

### 0.7.25-android.371：Vulkan Still 文本

- still 模式不再走整帧 Canvas，直接生成三行文字纹理；Vulkan 背景/粒子保留。

### 0.7.25-android.372：Classic Vulkan 文字层

- classic 只上传文字层，Vulkan 背景/粒子保留，不再整帧 Canvas。

### 0.7.25-android.373：全部现有模式文字层

- partita/cappella 也只上传文字层，Vulkan 背景/粒子保留。

### 0.7.25-android.374：Vulkan Lumiere 场景

- stage.frag 增加 lumiere 分支：暗场、灯束、尘埃。
- Java 传 mode；Vulkan push constant 选择场景。

### 0.7.25-android.375：Lumiere 文字层修复

- lumiere 不再走整帧 Canvas，避免盖住 Vulkan 灯束/尘埃。

### 0.7.25-android.376：Lumiere 灯束/地光

- lumiere 6 束灯、地面 glow、vignette。

### 0.7.25-android.377：Vulkan Sonnet 场景

- sonnet 分支：暖纸、墨晕、纸屑；文字层叠加。

### 0.7.25-android.378：Vulkan Nebbia 场景

- nebbia 分支：深色雾层；文字层叠加。

### 0.7.25-android.379：Vulkan Hanabi 场景

- hanabi 分支：夜空烟花爆点；文字层叠加。

### 0.7.25-android.380：Vulkan Machi 场景

- machi 分支：暖色城市 bokeh；文字层叠加。

### 0.7.25-android.381：Vulkan Fume 场景

- fume 分支：墨烟流体；文字层叠加。

### 0.7.25-android.382：Vulkan Monet 场景

- monet 分支：印象派水面/花瓣色块；文字层叠加。

### 0.7.25-android.383：Vulkan Diorama 场景

- diorama 分支：暖天空、太阳、层叠纸山脊；文字层叠加。

### 0.7.25-android.384：Vulkan Pendolo 场景

- pendolo 分支：摆动灯、光锥；文字层叠加。

### 0.7.25-android.385：Vulkan Tempera 场景

- tempera 分支：干笔刷横纹；文字层叠加。

### 0.7.25-android.386：Vulkan Tilt 场景

- tilt 分支：低光交叠几何平面；文字层叠加。

### 0.7.25-android.387：Vulkan Cadenza 场景

- cadenza 分支：五线谱与漂浮音符；文字层叠加。

### 0.7.25-android.388：Vulkan Claddagh 场景

- claddagh 分支：三个互锁圆环；文字层叠加。

### 0.7.25-android.389：Vulkan Partita 背景

- partita 分支：竖列+横线背景；文字层已有。

### 0.7.25-android.390：Vulkan Cappella 背景

- cappella 分支：暖色聊天背景与浮动气泡；文字层已有。

### 0.7.25-android.391：Vulkan Classic/Still 背景

- classic 分支：中性暗场呼吸光。
- still 分支：静态暗角。
- 所有内置歌词模式都有独立 Vulkan 背景。

### 0.7.25-android.392：Still 尺寸对齐

- still 当前行 40dp、非当前 30dp、翻译/间距按 CSS 尺寸。

### 0.7.25-android.393：Vulkan 字形图集构建器

- 新增 VulkanTextAtlas：字形栅格化、打包、UV/advance。
- 尚未接入 still 的 Vulkan quad 管线。

### 0.7.25-android.394：Still Vulkan 字形 quad

- VulkanTextAtlas 接入 still：atlas 上传 + glyph 顶点缓冲 + 实例化文字管线。
- still 不再每帧上传整张 Canvas 文字纹理。

### 0.7.25-android.395：Still 字形颜色/翻译

- glyph 顶点带颜色和 alpha；当前/非当前行透明度进 shader。
- 翻译副行进 glyph run。

### 0.7.25-android.396：Still 最大宽度/换行

- 896dp 最大宽度，按 glyph advance 换行；多行居中。

### 0.7.25-android.397：字形基线修正

- Glyph 记录 cell 内 baseline，quad top 按真实基线计算。

### 0.7.25-android.398：Still 单图集稳定版

- 回退未完成的双图集上传；非当前行按 0.75 缩放复用同一 atlas。
- 保留真实 baseline。

### 0.7.25-android.399：多字号 atlas

- Glyph 缓存按字号 key；40dp/30dp 字形同图集打包。
- 非当前行使用真实 30dp 字形，不再缩放复用。

### 0.7.25-android.400：Still 翻译 24dp

- 翻译副行使用独立 24dp 字形，不再缩放。

### 0.7.25-android.401：Still 字重

- 700/600/500 使用独立 Typeface，atlas key 含字重。

### 0.7.25-android.402：原生日间状态

- JNI nativeSetDaylight；push constant pad 传 daylight。
- still 日间背景压暗。

### 0.7.25-android.403：日间切换重建字形

- atlasKey 包含 daylight，切日间/夜间会重建顶点颜色。

### 0.7.25-android.404：图集溢出回退

- VulkanTextAtlas 溢出标记；still 溢出时回退 Canvas 文字。

### 0.7.25-android.405：修复自动关闭

- 移除 3 秒 no-frames 自动移除/fallback。
- surfaceChanged 时若 Vulkan 未就绪则重试 nativeCreate，处理 surfaceCreated 时尺寸为 0。

### 0.7.25-android.406：Vulkan 错误诊断

- nativeLastError 记录 Vulkan 失败步骤；诊断输出 vulkanError。

### 0.7.25-android.407：修复 Vulkan surface 泄漏

- nativeCreate 失败时销毁 VkSurface/Instance/Device，避免重试报 NATIVE_WINDOW_IN_USE。

### 0.7.25-android.408：Vulkan 验证回调

- 有 validation layer 时启用；错误消息写入 vulkanError。

### 0.7.25-android.409：背景管线最小回退

- pipeline -3 时用 simple.vert/simple.frag 创建最小背景，避免黑屏；诊断记录 fallback。

### 0.7.25-android.410：显式 viewport/scissor

- pipeline 提供静态 viewport/scissor，排除 Adreno 对空 pViewports 的 -3。

### 0.7.25-android.411：无 push 最小管线

- simple 管线使用独立无 push constant 布局；排除 pipeline layout 问题。

### 0.7.25-android.412：显式深度状态

- pipeline 提供 depth/stencil state，排除 Adreno 对空 pDepthStencilState 的 -3。

### 0.7.25-android.413：静态管线状态

- 背景管线去掉 dynamic state，使用静态 viewport/scissor。

### 0.7.25-android.414：无接口简单管线

- simple shader 去掉所有接口/描述符，验证 pipeline 状态本身。
- 文字管线失败不阻断背景出帧。

### 0.7.25-android.415：禁用管线优化

- VK_PIPELINE_CREATE_DISABLE_OPTIMIZATION_BIT；排除 Adreno 优化器 -3。

### 0.7.25-android.416：SPIR-V 1.0

- shader 改 --target-env=vulkan1.0，排除 SPIR-V 1.3 驱动兼容。

### 0.7.25-android.417：管线失败不阻断清屏

- API 1.0；pipeline 失败仍渲染 clear color，避免黑屏。
- 诊断新增 pipeline 布尔。

### 0.7.25-android.418：保留管线错误

- 文字管线跳过不再覆盖背景 pipeline 错误。

### 0.7.25-android.419：管线日志

- LOGE 输出 background/simple/text pipeline 结果、format、extent。

### 0.7.25-android.420：TextureView 宿主

- 原生舞台从 SurfaceView 改为 TextureView，修复 Surface 缓冲 dequeue 超时/设备丢失。

### 0.7.26-android.421：触屏速记簿把手

- pointer: coarse 时常显 28px 把手，不再只留 6px 边线。

### 0.7.26-android.422：移除命令面板按钮

- 删除底部命令面板按钮与“自动隐藏命令面板按钮”设置。

### 0.7.26-android.423：Apple Music Android companion

- FoliaAppleMusic 插件：隐藏 WebView 加载 music.apple.com，注入 desktop companion 的 requestExpression。
- JS 端 window.electron.appleMusicRequest 走 Capacitor 插件。
- 命令面板按钮/自动隐藏设置已移除。

### 0.7.26-android.424：修复 Apple Music 桥导致黑屏

- 不再伪造 window.electron（会把所有 isElectron 判定变成 true）。
- Apple Music 改走 window.foliaAppleMusicRequest。

### 0.7.26-android.425：Apple Music WebView 保持 1x1 可见

- 隐藏 WebView 不再 GONE，改为 1x1/alpha 0.01，避免 Chromium 挂起媒体/DRM。

### 0.7.26-android.426：授予 Widevine 权限

- WebChromeClient 对 music.apple.com 的 RESOURCE_PROTECTED_MEDIA_ID 授权，完整音轨不再退回 preview。

### 0.7.26-android.427：Apple Music 请求超时

- 20s 超时，避免 playSong 卡在“正在准备播放”。

### 0.7.26-android.428：Apple Music WebView 恢复媒体计时器

- onResume/resumeTimers/setKeepScreenOn，避免隐藏 WebView 音频被挂起。
