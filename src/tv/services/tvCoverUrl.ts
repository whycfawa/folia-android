import { toSafeRemoteUrl } from '../../utils/appPlaybackHelpers';
import { getSizedCoverUrl } from '../../utils/coverUrl';

// src/tv/services/tvCoverUrl.ts
// TV cover requests stay on the CDN size each surface actually paints, keeping the 160MB-heap
// projector from decoding dozens of 1024px bitmaps for 178px cards.

/** CDN steps used by TV surfaces: small list rows, cards/hero art, and full-screen backdrops. */
export const TV_COVER_SIZE = {
    row: 256,
    card: 512,
    backdrop: 1024,
} as const;

/** Sizes a TV cover URL after it has been normalized for the Android WebView. */
export const resolveTvCoverUrl = (
    url: string | null | undefined,
    size: number = TV_COVER_SIZE.card,
): string | null => {
    const safeUrl = toSafeRemoteUrl(url);
    if (!safeUrl) return null;
    return getSizedCoverUrl(safeUrl, size) || null;
};
