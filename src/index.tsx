import { Buffer } from 'buffer';
import { installGlobalVisualizerFrameRateLimiter } from './utils/frameRateLimiter';
import { installConsoleLogCapture } from './utils/consoleLogBuffer';
import { installDebugModule } from './services/debug/debugModule';
import { installMemorySampleFeed } from './services/debug/memorySamples';
import { installCrashDiagnostics } from './utils/crashDiagnostics';
import { installChunkLoadRecovery } from './utils/chunkLoadRecovery';
import { installFrameTimingDiagnostics } from './utils/frameTimingDiagnostics';
import { installNativeAndroidBridge } from './services/nativeAndroidBridge';
import { installAppleMusicAndroidBridge } from './services/appleMusicAndroidBridge';
import { installFnMusicAndroidBridge } from './services/fnmusicAndroidBridge';
import { installAndroidPhoneFitPreference } from './services/androidPhoneLayout';
import { installKeepScreenOnPreference } from './services/androidKeepScreenOn';
// import { installCoverSizeAudit } from './services/debug/coverSizeSamples';
// @ts-ignore
globalThis.Buffer = Buffer;
// First, so the debug overlay's console tab has the startup lines too - they are where a failure
// to reach a library or restore a session shows up.
installConsoleLogCapture();
// Right after it, so the startup lines reach the runtime log file too and not only the in-memory
// buffer. Both no-op off Electron. See services/debug/debugModule.ts.
installDebugModule();
installMemorySampleFeed();
// Cover size audit, left wired but switched off: it answered whether the provider CDNs honour the
// size in a cover URL - they do - and that is not a question worth re-asking every session. The
// collector and its panel are still in the tree, and `?probe=coverSizeAudit` still reaches them.
// To bring the tab back, uncomment this line and the four sites in DevDebugOverlay.tsx. It was dev
// only even then: a packaged build has nothing to do with the answer, so it should not pay the
// observer or the rows it retains.
// if (import.meta.env.DEV) installCoverSizeAudit();
installGlobalVisualizerFrameRateLimiter();
// ─── Android 移植：原生桥与设备行为 ───────────────────────────────────────────
// 上一行只装帧率限制器；下面这些都是 Android 版必需的运行时（桌面浏览器里是空操作）。
installCrashDiagnostics();
// 覆盖安装时旧 index.html 可能引用已被替换掉的 chunk：先装恢复器，再让 React 启动。
installChunkLoadRecovery();
// 帧耗时 / 长任务采样，供设置里的「复制诊断数据」判断卡顿是渲染开销还是设备性能。
installFrameTimingDiagnostics();
installAndroidPhoneFitPreference();
// 屏幕常亮：启动时套用保存的开关状态（安卓走原生窗口标志）。
installKeepScreenOnPreference();
// 原生桥：替换 fetch / 模拟扩展的 chrome.cookies / chrome.storage，所有在线请求走它。
void installNativeAndroidBridge();
installAppleMusicAndroidBridge();
installFnMusicAndroidBridge();

void import('./bootstrap');
// window.__foliaDev and the ?skipStartup / ?mockSong launch flags (src/dev/devLaunchFlags.ts).
if (import.meta.env.DEV) void import('./dev/devTools');
