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
