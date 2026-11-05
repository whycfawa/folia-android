import { useMotionValue, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { AudioBands } from '../../types';
import type { TvPlaybackStatus } from '../model/tvTypes';

// src/tv/hooks/useTvAudioAnalyser.ts
// One analyser tap for both the lyric stage and the full-page background. Sampling is capped at
// 24fps because React never consumes these values; only MotionValue-driven renderers do.

const TV_AUDIO_SAMPLE_INTERVAL_MS = 1000 / 24;
const TV_EMPTY_SPECTRUM = new Uint8Array(0);

type TvAudioGraph = {
    context: AudioContext;
    analyser: AnalyserNode;
};

// A media element can only ever be connected to one MediaElementSourceNode. StrictMode mounts
// effects twice in development, so the graph has to outlive the hook instead of being closed by
// the first cleanup pass. The TV page owns one persistent audio element for the app's lifetime.
const TV_AUDIO_GRAPHS = new WeakMap<HTMLAudioElement, TvAudioGraph>();

export type TvAudioSignals = {
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
};

const readBandEnergy = (
    data: Uint8Array<ArrayBuffer>,
    minHz: number,
    maxHz: number,
    binHz: number,
): number => {
    const start = Math.max(0, Math.floor(minHz / binHz));
    const end = Math.min(data.length - 1, Math.floor(maxHz / binHz));
    if (end < start) return 0;
    let sum = 0;
    for (let index = start; index <= end; index += 1) {
        sum += data[index];
    }
    return sum / (end - start + 1);
};

const shapeEnergy = (value: number, exponent: number): number => (
    Math.pow(value / 255, exponent) * 255
);

export const useTvAudioAnalyser = (
    audioRef: RefObject<HTMLAudioElement | null>,
    status: TvPlaybackStatus,
): TvAudioSignals => {
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const spectrum = useMotionValue<Uint8Array<ArrayBuffer>>(new Uint8Array(0));
    const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

    const resetSignals = useCallback(() => {
        audioPower.set(0);
        bass.set(0);
        lowMid.set(0);
        mid.set(0);
        vocal.set(0);
        treble.set(0);
        spectrum.set(TV_EMPTY_SPECTRUM);
    }, [audioPower, bass, lowMid, mid, spectrum, treble, vocal]);

    const ensureGraph = useCallback((): {
        context: AudioContext;
        analyser: AnalyserNode;
        binHz: number;
    } | null => {
        const audio = audioRef.current;
        if (!audio) return null;

        let graph = TV_AUDIO_GRAPHS.get(audio);
        if (!graph) {
            const AudioContextClass = window.AudioContext
                || (window as Window & typeof globalThis & {
                    webkitAudioContext?: typeof AudioContext;
                }).webkitAudioContext;
            if (!AudioContextClass) return null;

            const context = new AudioContextClass({ latencyHint: 'playback' });
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.62;
            try {
                const source = context.createMediaElementSource(audio);
                source.connect(analyser);
                analyser.connect(context.destination);
                graph = { context, analyser };
                TV_AUDIO_GRAPHS.set(audio, graph);
            } catch (error) {
                console.warn('[TV audio] analyser graph unavailable', error);
                void context.close().catch(() => undefined);
                return null;
            }
        }

        if (graph.context.state === 'closed') return null;
        if (graph.context.state === 'suspended') {
            void graph.context.resume().catch(() => undefined);
        }
        return {
            context: graph.context,
            analyser: graph.analyser,
            binHz: graph.context.sampleRate / 2 / graph.analyser.frequencyBinCount,
        };
    }, [audioRef]);

    useEffect(() => {
        if (status !== 'playing') {
            resetSignals();
            return undefined;
        }

        const graph = ensureGraph();
        if (!graph) {
            resetSignals();
            return undefined;
        }

        let frame = 0;
        let lastSampleAt = 0;
        const { analyser, binHz } = graph;

        const tick = (now: number) => {
            if (now - lastSampleAt >= TV_AUDIO_SAMPLE_INTERVAL_MS) {
                lastSampleAt = now;
                const bufferLength = analyser.frequencyBinCount;
                let data = frequencyDataRef.current;
                if (!data || data.length !== bufferLength) {
                    data = new Uint8Array(bufferLength);
                    frequencyDataRef.current = data;
                }
                analyser.getByteFrequencyData(data);
                spectrum.set(data);

                const bassValue = readBandEnergy(data, 20, 150, binHz);
                const lowMidValue = readBandEnergy(data, 150, 400, binHz);
                const midValue = readBandEnergy(data, 400, 1200, binHz);
                const vocalValue = readBandEnergy(data, 1000, 3500, binHz);
                const trebleValue = readBandEnergy(data, 3500, 12000, binHz);

                audioPower.set(shapeEnergy((bassValue + lowMidValue) / 2, 3));
                bass.set(shapeEnergy(bassValue, 1.8));
                lowMid.set(shapeEnergy(lowMidValue, 2));
                mid.set(shapeEnergy(midValue, 2));
                vocal.set(shapeEnergy(vocalValue, 1.5));
                treble.set(shapeEnergy(trebleValue, 2));
            }
            frame = window.requestAnimationFrame(tick);
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [ensureGraph, resetSignals, status]);

    const audioBands = useMemo<AudioBands>(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
        spectrum,
    }), [bass, lowMid, mid, spectrum, treble, vocal]);

    return { audioPower, audioBands };
};
