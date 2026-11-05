// src/tv/components/TvMediaRow.tsx

import type { ReactNode } from 'react';

export const TvMediaRow = ({
    title,
    subtitle,
    focusGroup,
    children,
}: {
    title: string;
    subtitle?: string;
    focusGroup: string;
    children: ReactNode;
}) => (
    <section className="tv-media-row">
        <div className="tv-row-heading">
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
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

