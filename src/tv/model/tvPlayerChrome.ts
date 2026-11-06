// src/tv/model/tvPlayerChrome.ts

import type { TvRemoteAction } from '../input/tvKeys';

/** Player chrome opens on any listening action except Back, which keeps its navigation meaning. */
export const shouldRevealTvPlayerChrome = (action: TvRemoteAction): boolean => action !== 'back';
