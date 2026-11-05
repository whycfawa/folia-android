import { useEffect, useState } from 'react';

// src/hooks/useElementWidth.ts
// Tracks an element's rendered box so measured-size layout follows resizes.

export interface ElementSize {
    width: number;
    height: number;
}

const EMPTY_ELEMENT_SIZE: ElementSize = { width: 0, height: 0 };

/**
 * Returns the observed content-box size of `ref`, or zeroes before the first measurement.
 *
 * Reading `window.innerWidth` during render is both unreactive — nothing re-renders on resize — and
 * wrong for an embedded renderer, where a small preview on a large display would size itself from
 * the display. Observe the container instead and let the caller decide its fallback.
 */
export const useElementSize = (ref: React.RefObject<HTMLElement | null>): ElementSize => {
    const [size, setSize] = useState(EMPTY_ELEMENT_SIZE);

    useEffect(() => {
        const node = ref.current;
        if (!node) {
            return;
        }

        const updateSize = () => {
            const nextSize = {
                width: Math.round(node.clientWidth),
                height: Math.round(node.clientHeight),
            };
            setSize(current => (
                current.width === nextSize.width && current.height === nextSize.height
                    ? current
                    : nextSize
            ));
        };

        updateSize();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, [ref]);

    return size;
};

export const useElementWidth = (ref: React.RefObject<HTMLElement | null>): number => (
    useElementSize(ref).width
);

export default useElementWidth;
