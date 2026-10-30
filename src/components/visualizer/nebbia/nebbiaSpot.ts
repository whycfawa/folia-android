import { clamp, smooth } from './nebbiaConstants';
import type { LaidChar, LaidLine } from './nebbiaScene';

// src/components/visualizer/nebbia/nebbiaSpot.ts
// 聚光灯：远处楼底下两盏（左右对称）打向正在唱的字，强调色；这句唱完 0.8 秒后慢慢熄灭。
// 目标点沿着字连续移动（唱第 i 个字的过程中从第 i 个字滑向第 i+1 个字），用临界阻尼弹簧去追，速度也连续；
// 播放时间是一跳一跳更新的，用自己平滑过的时钟。每换一个字就瞬移目标、一阶指数追，快歌里会一抽一抽。

// 当前在唱的字，以及同一句里它后面的下一个字
const currentSungChar = (laid: LaidLine[], T: number): { c: LaidChar; next: LaidChar | null } | null => {
    let best: LaidChar | null = null, bestLine: LaidLine | null = null;
    for (const line of laid) {
        if (T < line.t - 0.05 || T > line.end + 0.8) continue;
        for (const c of line.chars) if (c.glyph && c.t <= T && (!best || c.t >= best.t)) { best = c; bestLine = line; }
    }
    if (!best || !bestLine) return null;
    const k = bestLine.chars.indexOf(best);
    return { c: best, next: bestLine.chars.slice(k + 1).find(c => c.glyph) ?? null };
};

export class NebbiaSpot {
    x = 0; y = 0; r = 0; i = 0;
    private vx = 0; private vy = 0; private vr = 0;
    private t = 0;
    private init = false;

    /** 一帧：T 是播放时间，dt 是真实流逝的秒数（暂停时 0）。 */
    update(laid: LaidLine[], T: number, dt: number) {
        // 平滑时钟：离播放时间太远（拖进度、暂停）就直接对齐，否则慢慢往播放时间靠
        this.t += dt;
        if (Math.abs(T - this.t) > 0.25 || dt === 0) this.t = T;
        else this.t += (T - this.t) * (1 - Math.exp(-dt / 0.3));
        const cur = currentSungChar(laid, this.t);
        if (cur) {
            const { c, next } = cur;
            const u = next ? smooth(clamp((this.t - c.t) / Math.max(0.05, next.t - c.t))) : 0;
            const gx = next ? c.x + (next.x - c.x) * u : c.x, gy = next ? c.y + (next.y - c.y) * u : c.y, gr = next ? c.s + (next.s - c.s) * u : c.s;
            if (!this.init || dt === 0) {
                this.x = gx; this.y = gy; this.r = gr;
                this.vx = this.vy = this.vr = 0;
                this.init = true;
            }
            // 临界阻尼弹簧，分几步积分保证稳定；时间常数约 0.1 秒
            const w = 1 / 0.1, n = Math.ceil(dt / 0.008);
            for (let j = 0; j < n; j += 1) {
                const h = dt / n;
                this.vx += (w * w * (gx - this.x) - 2 * w * this.vx) * h; this.x += this.vx * h;
                this.vy += (w * w * (gy - this.y) - 2 * w * this.vy) * h; this.y += this.vy * h;
                this.vr += (w * w * (gr - this.r) - 2 * w * this.vr) * h; this.r += this.vr * h;
            }
        }
        if (dt === 0) this.i = cur ? 1 : 0;
        else this.i += ((cur ? 1 : 0) - this.i) * (1 - Math.exp(-dt / (cur ? 0.15 : 0.5)));
    }

    reset() {
        this.init = false;
        this.i = 0;
    }
}
