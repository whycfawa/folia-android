// src/tv/input/focusNavigation.ts
// Geometry-only focus selection for the D-pad. Browser tab order is unrelated to what is on screen
// in this UI, so every directional press is resolved from the rectangles the active layer exposes.

export type TvDirection = 'up' | 'down' | 'left' | 'right';

export type TvFocusRect = {
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    group?: string;
    groupAxis?: 'horizontal' | 'vertical';
    groupEntry?: 'selected';
    selected?: boolean;
    container?: string;
};

const center = (rect: TvFocusRect) => ({
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
});

const overlap = (
    startA: number,
    endA: number,
    startB: number,
    endB: number,
): number => Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));

export const pickNextFocusRect = (
    rects: readonly TvFocusRect[],
    currentId: string | null,
    direction: TvDirection,
): TvFocusRect | null => {
    const current = rects.find(rect => rect.id === currentId) ?? null;
    if (!current) return rects[0] ?? null;

    const currentCenter = center(current);
    const horizontal = direction === 'left' || direction === 'right';
    const groupAxis = horizontal ? 'horizontal' : 'vertical';
    const sameGroup = current.group
        ? rects.filter(rect => rect.group === current.group)
        : [];
    const sameContainer = !horizontal && current.container
        ? rects.filter(rect => rect.container === current.container)
        : [];
    const lockedToGroup = Boolean(
        current.group
        && sameGroup.length > 0
        && current.groupAxis === groupAxis,
    );
    const candidates = lockedToGroup
        ? sameGroup
        : sameContainer.length > 0
            ? sameContainer
            : rects;
    const sign = direction === 'right' || direction === 'down' ? 1 : -1;

    const findBest = (pool: readonly TvFocusRect[]): TvFocusRect | null => {
        let bestRect: TvFocusRect | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        pool.forEach(rect => {
            if (rect.id === current.id) return;
            const candidateCenter = center(rect);
            const primary = horizontal
                ? (candidateCenter.x - currentCenter.x) * sign
                : (candidateCenter.y - currentCenter.y) * sign;
            if (primary <= 4) return;

            const cross = horizontal
                ? Math.abs(candidateCenter.y - currentCenter.y)
                : Math.abs(candidateCenter.x - currentCenter.x);
            const aligned = horizontal
                ? overlap(current.top, current.bottom, rect.top, rect.bottom)
                : overlap(current.left, current.right, rect.left, rect.right);
            const score = horizontal
                ? primary + cross * 2.4 - aligned * 0.9
                : Math.max(
                    0,
                    direction === 'down' ? rect.top - current.bottom : current.top - rect.bottom,
                ) + cross * 0.25 - aligned * 0.1;

            if (
                !bestRect
                || score < bestScore
                || (Math.abs(score - bestScore) < 0.001 && rect.id.localeCompare(bestRect.id) < 0)
            ) {
                bestRect = rect;
                bestScore = score;
            }
        });

        return bestRect;
    };

    let next = findBest(candidates);
    if (!next && candidates !== rects && !lockedToGroup) next = findBest(rects);
    if (!next && lockedToGroup && current.groupAxis === 'vertical') {
        next = findBest(rects.filter(rect => rect.group !== current.group));
    }

    if (
        next
        && next.group !== current.group
        && next.groupEntry === 'selected'
    ) {
        next = rects.find(rect => (
            rect.group === next?.group
            && rect.selected
        )) ?? next;
    }

    return next ?? current;
};
