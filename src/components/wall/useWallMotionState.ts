import { useCallback, useEffect, useRef, type RefObject } from 'react';

// src/components/wall/useWallMotionState.ts
// 墙（Lattice / bravais）的「正在动」性能态：拖动、滚轮、惯性与相机补间时给根节点挂 data-wall-scrolling，
// 最后一帧之后约 150ms 撤掉。调用方每帧只更新一个时间戳；属性写入合并到下一帧（rAF）且只在开关沿发生，
// 不经过 React state，也不在 pointermove / wheel 里直接读写 DOM。

/** 最后一帧之后属性还留多久：盖住惯性、平滑滚轮与补间的尾帧，不让效果开关来回拨。 */
export const WALL_SCROLLING_IDLE_MS = 150;
/** 根节点上的属性名（样式见 components/wall/wall.css 的「滑动中」一节）。 */
export const WALL_SCROLLING_ATTRIBUTE = 'data-wall-scrolling';

export const useWallMotionState = (rootRef: RefObject<HTMLElement | null>) => {
    const activeRef = useRef(false);
    const frameRef = useRef<number | null>(null);
    const timerRef = useRef<number | null>(null);
    const lastMoveRef = useRef(0);

    const clearScrolling = useCallback(() => {
        activeRef.current = false;
        rootRef.current?.removeAttribute(WALL_SCROLLING_ATTRIBUTE);
    }, [rootRef]);

    /** 到点后如果又动过，就按剩下的时间再排一次；不动了才撤掉。 */
    const scheduleStop = useCallback(() => {
        if (timerRef.current !== null) return;
        const tick = () => {
            const remaining = WALL_SCROLLING_IDLE_MS - (performance.now() - lastMoveRef.current);
            if (remaining > 0) {
                timerRef.current = window.setTimeout(tick, remaining);
                return;
            }
            timerRef.current = null;
            clearScrolling();
        };
        timerRef.current = window.setTimeout(tick, WALL_SCROLLING_IDLE_MS);
    }, [clearScrolling]);

    const markMoving = useCallback(() => {
        lastMoveRef.current = performance.now();
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            const root = rootRef.current;
            if (!root) return;
            if (!activeRef.current) {
                activeRef.current = true;
                root.setAttribute(WALL_SCROLLING_ATTRIBUTE, '');
            }
            scheduleStop();
        });
    }, [rootRef, scheduleStop]);

    useEffect(() => () => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        frameRef.current = null;
        timerRef.current = null;
        // StrictMode 会先卸载再挂载同一个 hook：属性也撤掉、清空「已经挂上」的标记，下一帧才会重新写。
        activeRef.current = false;
        rootRef.current?.removeAttribute(WALL_SCROLLING_ATTRIBUTE);
    }, [rootRef]);

    return markMoving;
};
