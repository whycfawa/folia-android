#!/usr/bin/env node
// dev/android/lxSandboxAsset.mjs
//
// 把洛雪音源的沙箱运行环境（dist-mods/lxmusic/sandbox.cjs）拷进 APK 的 assets：安卓那边
// FoliaLxSandboxPlugin 把它读成文本，注入隐藏 WebView。网页包（vite build）碰不到 assets，
// 所以这一步必须跟着 build:capacitor 走，不能靠手记。
//
// 用法：node dev/android/lxSandboxAsset.mjs

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = join(ROOT, 'dist-mods/lxmusic/sandbox.cjs');
const TARGET = join(ROOT, 'android/app/src/main/assets/lxSandbox.js');

if (!existsSync(SOURCE)) {
    console.error('[lx-sandbox] 找不到 dist-mods/lxmusic/sandbox.cjs：先跑 `npm run sources:build`（FOLIA_BUNDLED_SOURCES 要含 lxmusic）');
    process.exit(1);
}

mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(SOURCE, TARGET);
console.log(`[lx-sandbox] assets/lxSandbox.js ← ${(statSync(TARGET).size / 1024).toFixed(1)} KB`);
