// src/tv/components/TvMediaRow.tsx

import type { ReactNode } from 'react';

export const TvMediaRow = ({
    title,
    focusGroup,
    children,
}: {
    title: string;
    focusGroup: string;
    children: ReactNode;
}) => (
    <section className="tv-media-row">
        <div className="tv-row-heading">
            <h2>{title}</h2>
        </div>
        <div
            className="tv-row-scroll"
            data-tv-focus-group={focusGroup}
            data-tv-focus-axis="horizontal"
        >
            {children}
        </div>
    </section>
);

export const TvRowStatus = ({
    focusKey,
    children,
}: {
    focusKey: string;
    children: ReactNode;
}) => (
    <div
        className="tv-row-empty"
        data-tv-focusable="true"
        data-tv-focus-key={focusKey}
        tabIndex={-1}
    >
        {children}
    </div>
);

