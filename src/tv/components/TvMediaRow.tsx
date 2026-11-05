// src/tv/components/TvMediaRow.tsx

import type { ReactNode } from 'react';

export const TvMediaRow = ({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: ReactNode;
}) => (
    <section className="tv-media-row">
        <div className="tv-row-heading">
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
        </div>
        <div className="tv-row-scroll">
            {children}
        </div>
    </section>
);

