// test/unit/tv/tvKeys.test.ts

import { describe, expect, it } from 'vitest';
import { isTvDirection, resolveTvRemoteAction } from '../../../src/tv/input/tvKeys';

describe('resolveTvRemoteAction', () => {
    it('maps Android TV dpad key codes', () => {
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 19 })).toBe('up');
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 20 })).toBe('down');
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 21 })).toBe('left');
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 22 })).toBe('right');
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 23 })).toBe('ok');
        expect(resolveTvRemoteAction({ key: 'Unidentified', keyCode: 4 })).toBe('back');
    });

    it('maps browser and advisory key names', () => {
        expect(resolveTvRemoteAction({ key: 'Enter' })).toBe('ok');
        expect(resolveTvRemoteAction({ key: 'DPAD_CENTER' })).toBe('ok');
        expect(resolveTvRemoteAction({ key: 'BrowserBack' })).toBe('back');
        expect(resolveTvRemoteAction({ key: 'Escape' })).toBe('back');
    });

    it('leaves unrelated keys to the browser', () => {
        expect(resolveTvRemoteAction({ key: 'k' })).toBeNull();
        expect(resolveTvRemoteAction({ key: 'F5', keyCode: 131 })).toBeNull();
    });
});

describe('isTvDirection', () => {
    it('separates directional actions from OK and Back', () => {
        expect(isTvDirection('left')).toBe(true);
        expect(isTvDirection('down')).toBe(true);
        expect(isTvDirection('ok')).toBe(false);
        expect(isTvDirection('back')).toBe(false);
    });
});

