// src/tv/components/TvLyricToken.tsx

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { resolveTvLyricTokenOpacity } from '../model/tvLyricFill';

type TvLyricTokenProps = {
    char: string;
    startTime: number;
    endTime: number;
    currentTime: MotionValue<number>;
};

const TvSteadyLyricToken = ({
    char,
    startTime,
    endTime,
    currentTime,
}: TvLyricTokenProps) => {
    const opacity = useTransform(currentTime, time => (
        resolveTvLyricTokenOpacity(time, startTime, endTime)
    ));

    return (
        <span className="tv-lyric-token">
            <span className="tv-lyric-token-base" aria-hidden="true">
                {char === ' ' ? '\u00A0' : char}
            </span>
            <motion.span className="tv-lyric-token-lit" style={{ opacity }} aria-hidden="true">
                {char === ' ' ? '\u00A0' : char}
            </motion.span>
        </span>
    );
};

const TvBalancedLyricToken = ({
    char,
    startTime,
    endTime,
    currentTime,
}: TvLyricTokenProps) => {
    const opacity = useTransform(currentTime, time => (
        resolveTvLyricTokenOpacity(time, startTime, endTime)
    ));
    const scale = useTransform(currentTime, time => {
        if (time < startTime) return 1;
        if (time >= endTime) return 1;
        const progress = (time - startTime) / Math.max(0.001, endTime - startTime);
        return 1 + Math.sin(progress * Math.PI) * 0.045;
    });

    return (
        <span className="tv-lyric-token">
            <span className="tv-lyric-token-base" aria-hidden="true">
                {char === ' ' ? '\u00A0' : char}
            </span>
            <motion.span
                className="tv-lyric-token-lit"
                style={{ opacity, scale }}
                aria-hidden="true"
            >
                {char === ' ' ? '\u00A0' : char}
            </motion.span>
        </span>
    );
};

export const TvLyricToken = ({
    char,
    startTime,
    endTime,
    currentTime,
    calm,
}: TvLyricTokenProps & {
    calm: boolean;
}) => {
    if (calm) {
        return (
            <TvSteadyLyricToken
                char={char}
                startTime={startTime}
                endTime={endTime}
                currentTime={currentTime}
            />
        );
    }
    return (
        <TvBalancedLyricToken
            char={char}
            startTime={startTime}
            endTime={endTime}
            currentTime={currentTime}
        />
    );
};

