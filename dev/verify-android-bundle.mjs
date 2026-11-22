#!/usr/bin/env node
// dev/verify-android-bundle.mjs
//
// 发布前检查：本轮的关键标记必须同时出现在
//   1) vite 的 dist 输出里（web 包是新的），
//   2) `npx cap sync android` 复制后的 android/app/src/main/assets/public 里（APK 拿到的也是新的）。
// 以前出过「代码改了、构建顺序错了，装上的 APK 还是旧 bundle」的问题（.218 的诊断标记没进包），
// 这个脚本用几条不会被打包器改名的字符串挡住它。
//
// 用法：node dev/verify-android-bundle.mjs [--require <标记>]...

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
    'dist/assets',
    'android/app/src/main/assets/public/assets',
];

// 每轮改动后在下面补一条能唯一指认本次改动的字符串（打包器不会改字符串字面量）。
const SENTINELS = [
    // 酷狗概念版/标准版：会员识别、取链重试、补领、播放路由
    'conceptVipType',
    'auth:user-vip:probe',
    'url:retry-vip-state',
    'claim-on-fail:start',
    'youth:union:done',
    'native-stream:',
    'proxy-source',
    // 网易云探索页路由 / 安卓桥登录
    'explore:route',
    'explore:daily:source',
    'daily:read',
    'ne:qr:key:start',
    // 播放失败可见化
    'media-error-',
    // 0.7.22 汽水音乐安卓桥：协议移植、可用性、原生 HTTP/媒体白名单
    'qishuiSessionV1',
    'Qishui Android bridge request failed',
    'LunaOpenSDK/1.0.10',
    'sendCookies',
    'qishuiDeviceId',
];

const extra = [];
for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--require' && process.argv[index + 1]) extra.push(process.argv[index + 1]);
}

const sentinels = [...SENTINELS, ...extra];

const readText = (file) => readFileSync(file, 'utf8');

// Tailwind v4 默认把断点写成媒体查询区间语法（`@media (width >= 48rem)`），Chromium 104 才支持。
// 旧 Android System WebView 会把整档规则静默丢掉，JS 的 matchMedia 却照常匹配，布局两半裂开
// （横屏设置弹窗整页空白就是这么来的）。构建里已经改写成经典语法，这里守住不让它再漏出来。
// 判定和构建插件共用一套：媒体/容器查询参数里只要出现比较符号就算不合法。
const AT_RULE_PARAMS = /@(?:media|container)\b[^{;]*/g;

const findRangeQueries = (css) => (css.match(AT_RULE_PARAMS) ?? []).filter(params => /[<>]/.test(params));

const scanCssForRangeQueries = (root) => {
    if (!existsSync(root)) return null;
    const offenders = [];
    const walk = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { walk(path); continue; }
            if (!entry.name.endsWith('.css')) continue;
            const hits = findRangeQueries(readText(path));
            if (hits.length > 0) offenders.push({ path, hits });
        }
    };
    walk(root);
    return offenders;
};

const scanRoot = (root) => {
    if (!existsSync(root)) return { root, missing: sentinels, files: 0 };
    const found = new Set();
    let files = 0;
    const walk = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { walk(path); continue; }
            if (!entry.name.endsWith('.js')) continue;
            files += 1;
            const text = readText(path);
            for (const sentinel of sentinels) {
                if (!found.has(sentinel) && text.includes(sentinel)) found.add(sentinel);
            }
        }
    };
    walk(root);
    return { root, missing: sentinels.filter((sentinel) => !found.has(sentinel)), files };
};

let failed = false;
for (const root of ROOTS) {
    const result = scanRoot(root);
    if (result.missing.length === 0) {
        console.log(`[verify-android] ✅ ${root}（${result.files} 个 js，全部标记都在）`);
    } else {
        failed = true;
        console.error(`[verify-android] ❌ ${root}（${result.files} 个 js，缺 ${result.missing.length} 个标记）`);
        for (const missing of result.missing) console.error(`  - ${missing}`);
    }
}

for (const root of ROOTS) {
    const offenders = scanCssForRangeQueries(root);
    if (offenders === null) {
        failed = true;
        console.error(`[verify-android] ❌ ${root}（目录不存在，没法核对 css）`);
    } else if (offenders.length === 0) {
        console.log(`[verify-android] ✅ ${root}（css 里没有区间语法的媒体查询）`);
    } else {
        failed = true;
        console.error(`[verify-android] ❌ ${root}（css 里还有区间语法的媒体查询，旧 WebView 会整档丢弃）`);
        for (const offender of offenders) {
            console.error(`  - ${offender.path}`);
            for (const hit of offender.hits.slice(0, 3)) console.error(`      ${hit}`);
        }
    }
}

if (failed) {
    console.error('[verify-android] 构建顺序应为：npm run build:capacitor → npx cap sync android → gradle assembleDebug');
    process.exit(1);
}
console.log('[verify-android] OK');
