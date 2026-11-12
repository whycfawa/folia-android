import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// dev/android-icons.mjs
// 安卓启动图标由 build/icon.png（上游那一张，黑底四块白积木拼的 F）生成，别手改 res 里的 png。
// 跑：node dev/android-icons.mjs
//
// @capacitor/assets 3.0.5 的自适应图层走的是旧尺寸（108dp 的前景被生成成 48px），这里自己算：
//   - ic_launcher / ic_launcher_round：36/48/72/96/144/192（旧式图标，圆角方与圆形各一份）
//   - ic_launcher_foreground / _background：81/108/162/216/324/432（自适应，前景只放那些白块）
// 自适应图标的可见区是 108dp 里的 72dp，安全圈直径 66dp（61.1%）：F 的高宽比 340:250，
// 放进那个圆里高约 49.2%、宽约 36.2% —— 这样任何形状的遮罩（圆形、方形、squircle）都不会切到笔画。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'build', 'icon.png');
const resPath = join(repoRoot, 'android', 'app', 'src', 'main', 'res');

const DENSITIES = [
    { name: 'ldpi', legacy: 36, adaptive: 81 },
    { name: 'mdpi', legacy: 48, adaptive: 108 },
    { name: 'hdpi', legacy: 72, adaptive: 162 },
    { name: 'xhdpi', legacy: 96, adaptive: 216 },
    { name: 'xxhdpi', legacy: 144, adaptive: 324 },
    { name: 'xxxhdpi', legacy: 192, adaptive: 432 },
];

/** 源图里的白色部分（那几块积木）单独切出来，保留抗锯齿：黑底白块的亮度就是白块的 alpha。 */
const readBlocks = async () => {
    const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const rgba = Buffer.alloc(width * height * 4);
    let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * channels;
            const lum = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
            const o = (y * width + x) * 4;
            rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = lum;
            if (lum > 24) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) throw new Error('build/icon.png has no white blocks to use as the mark');
    return {
        png: await sharp(rgba, { raw: { width, height, channels: 4 } })
            .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
            .png().toBuffer(),
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
};

/** 自适应前景：白块缩到安全圈里，居中放在透明画布上。 */
const adaptiveForeground = async (size, mark) => {
    const limit = size * 0.611;
    const scale = limit / Math.hypot(1, mark.width / mark.height);
    const height = Math.round(scale);
    const width = Math.round(scale * (mark.width / mark.height));
    const scaled = await sharp(mark.png).resize(width, height, { kernel: 'lanczos3' }).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: scaled, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
        .png().toBuffer();
};

/** 旧式图标：整张图（黑底圆角方 + 白块）缩到目标尺寸。 */
const legacyIcon = (size) => sharp(source).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();

/** 圆形图标：同一张图套一个圆形蒙版。 */
const roundIcon = async (size) => {
    const base = await legacyIcon(size);
    const mask = Buffer.from('<svg width="' + size + '" height="' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + size / 2 + '" fill="#ffffff"/></svg>');
    return sharp(base).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
};

const MARK = await readBlocks();
for (const density of DENSITIES) {
    const dir = join(resPath, 'mipmap-' + density.name);
    writeFileSync(join(dir, 'ic_launcher.png'), await legacyIcon(density.legacy));
    writeFileSync(join(dir, 'ic_launcher_round.png'), await roundIcon(density.legacy));
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await adaptiveForeground(density.adaptive, MARK));
    writeFileSync(join(dir, 'ic_launcher_background.png'), await sharp({
        create: { width: density.adaptive, height: density.adaptive, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer());
}

const ADAPTIVE_XML = '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    + '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
    + '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
    + '</adaptive-icon>\n';
const anydpi = join(resPath, 'mipmap-anydpi-v26');
writeFileSync(join(anydpi, 'ic_launcher.xml'), ADAPTIVE_XML);
writeFileSync(join(anydpi, 'ic_launcher_round.xml'), ADAPTIVE_XML);

console.log('安卓图标已按 build/icon.png 重新生成：' + DENSITIES.map(d => d.name).join(' '));
