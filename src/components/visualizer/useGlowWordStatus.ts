import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

// src/components/visualizer/useGlowWordStatus.ts
// Keep word/chunk status discrete, including paused mounts, delayed lyrics and seeks.

export const useGlowWordStatus = (
    currentTime: MotionValue<number>,
    startTime: number,
    endTime: number,
    lookahead: number,
) => {
    const resolveStatus = useCallback((time: number): 'waiting' | 'active' | 'passed' => (
        time > endTime ? 'passed' : time >= startTime - lookahead ? 'active' : 'waiting'
    ), [endTime, lookahead, startTime]);
    const [status, setStatus] = useState(() => resolveStatus(currentTime.get()));
    const statusRef = useRef(status);

    const syncStatus = useCallback((time: number) => {
        const next = resolveStatus(time);
        if (statusRef.current === next) return;
        statusRef.current = next;
        setStatus(next);
    }, [resolveStatus]);

    useMotionValueEvent(currentTime, 'change', syncStatus);
    useEffect(() => syncStatus(currentTime.get()), [currentTime, syncStatus]);
    return status;
};
