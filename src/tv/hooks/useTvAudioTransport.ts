// src/tv/hooks/useTvAudioTransport.ts

import { useMotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TvPlaybackStatus } from '../model/tvTypes';

const TV_CLOCK_FRAME_MS = 1000 / 30;

export type TvAudioTransport = {
    audioRef: React.RefObject<HTMLAudioElement | null>;
    currentTime: ReturnType<typeof useMotionValue<number>>;
    positionRevision: number;
    status: TvPlaybackStatus;
    duration: number;
    hasSource: boolean;
    loadSource: (audioSrc: string, autoPlay: boolean) => void;
    resume: () => Promise<boolean>;
    pause: () => void;
    seekBy: (deltaSeconds: number) => void;
    reset: () => void;
    fail: () => void;
};

/**
 * Owns the one audio element TV playback uses. Position reaches the lyric canvas and the control
 * clock through a MotionValue at 30fps; React only hears about transport state changes.
 */
export const useTvAudioTransport = ({
    onEnded,
    onError,
}: {
    onEnded: () => void;
    onError: () => void;
}): TvAudioTransport => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const currentTime = useMotionValue(0);
    const [status, setStatus] = useState<TvPlaybackStatus>('idle');
    const [duration, setDuration] = useState(0);
    const [sourceRevision, setSourceRevision] = useState(0);
    const [positionRevision, setPositionRevision] = useState(0);
    const endedRef = useRef(onEnded);
    const errorRef = useRef(onError);
    endedRef.current = onEnded;
    errorRef.current = onError;

    const reset = useCallback(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
        setStatus('idle');
        setDuration(0);
        setSourceRevision(0);
        currentTime.set(0);
    }, [currentTime]);

    const fail = useCallback(() => {
        audioRef.current?.pause();
        setStatus('error');
    }, []);

    const loadSource = useCallback((audioSrc: string, autoPlay: boolean) => {
        const audio = audioRef.current;
        if (!audio) return;
        setStatus('loading');
        currentTime.set(0);
        audio.src = audioSrc;
        audio.load();
        setSourceRevision(revision => revision + 1);
        if (!autoPlay) {
            setStatus('paused');
            return;
        }
        void audio.play().catch(() => {
            setStatus('paused');
        });
    }, [currentTime]);

    const pause = useCallback(() => {
        audioRef.current?.pause();
        setStatus(current => (current === 'idle' || current === 'error' ? current : 'paused'));
    }, []);

    const resume = useCallback(async (): Promise<boolean> => {
        const audio = audioRef.current;
        if (!audio?.src) return false;
        try {
            await audio.play();
            return true;
        } catch {
            setStatus('paused');
            return false;
        }
    }, []);

    const seekBy = useCallback((deltaSeconds: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        const max = Number.isFinite(audio.duration) ? audio.duration : duration;
        const nextTime = Math.max(0, Math.min(max || Number.POSITIVE_INFINITY, audio.currentTime + deltaSeconds));
        audio.currentTime = nextTime;
        currentTime.set(nextTime);
    }, [currentTime, duration]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return undefined;

        const handleMetadata = () => {
            const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
            setDuration(nextDuration);
        };
        const handlePlaying = () => setStatus('playing');
        const handlePause = () => {
            if (!audio.ended) setStatus(current => (current === 'loading' ? current : 'paused'));
        };
        const handleEnded = () => {
            setStatus('paused');
            endedRef.current();
        };
        const handleError = () => {
            if (!audio.currentSrc) return;
            setStatus('error');
            errorRef.current();
        };
        const handleSeeked = () => {
            currentTime.set(audio.currentTime);
            setPositionRevision(revision => revision + 1);
        };

        audio.addEventListener('loadedmetadata', handleMetadata);
        audio.addEventListener('durationchange', handleMetadata);
        audio.addEventListener('playing', handlePlaying);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);
        audio.addEventListener('seeked', handleSeeked);
        return () => {
            audio.removeEventListener('loadedmetadata', handleMetadata);
            audio.removeEventListener('durationchange', handleMetadata);
            audio.removeEventListener('playing', handlePlaying);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
            audio.removeEventListener('seeked', handleSeeked);
        };
    }, [currentTime]);

    useEffect(() => {
        if (status !== 'playing') return undefined;
        let frame = 0;
        let lastFrameAt = 0;

        const tick = (now: number) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (now - lastFrameAt >= TV_CLOCK_FRAME_MS) {
                lastFrameAt = now;
                currentTime.set(audio.currentTime);
            }
            frame = window.requestAnimationFrame(tick);
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [currentTime, status, sourceRevision]);

    return {
        audioRef,
        currentTime,
        positionRevision,
        status,
        duration,
        hasSource: sourceRevision > 0,
        loadSource,
        resume,
        pause,
        seekBy,
        reset,
        fail,
    };
};

