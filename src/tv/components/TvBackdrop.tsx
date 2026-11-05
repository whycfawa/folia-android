// src/tv/components/TvBackdrop.tsx

export const TvBackdrop = ({
    coverUrl,
    calm = false,
}: {
    coverUrl?: string | null;
    calm?: boolean;
}) => (
    <div
        className={`tv-backdrop${calm ? ' is-calm' : ''}`}
        aria-hidden="true"
    >
        {coverUrl && (
            <div
                className="tv-backdrop-cover"
                style={{ backgroundImage: `url("${coverUrl.replace(/"/g, '\\"')}")` }}
            />
        )}
        <div className="tv-backdrop-wash" />
        <div className="tv-aurora tv-aurora-a" />
        <div className="tv-aurora tv-aurora-b" />
        <div className="tv-vignette" />
    </div>
);

