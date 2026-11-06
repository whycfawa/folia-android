// test/unit/tv/tvPlayerChrome.test.ts

import { describe, expect, it } from 'vitest';
import { shouldRevealTvPlayerChrome } from '../../../src/tv/model/tvPlayerChrome';

describe('TV player chrome activation', () => {
    it.each(['up', 'down', 'left', 'right', 'ok', 'menu'] as const)(
        'reveals on %s',
        action => {
            expect(shouldRevealTvPlayerChrome(action)).toBe(true);
        },
    );

    it('keeps Back assigned to navigation', () => {
        expect(shouldRevealTvPlayerChrome('back')).toBe(false);
    });
});
