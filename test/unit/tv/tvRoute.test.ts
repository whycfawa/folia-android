// test/unit/tv/tvRoute.test.ts

import { describe, expect, it } from 'vitest';
import { resolveTvBackRoute, resolveTvLayer, TV_HOME_ROUTE } from '../../../src/tv/model/tvRoute';

describe('TV route layers', () => {
    it('gives every overlay its own focus layer', () => {
        expect(resolveTvLayer(TV_HOME_ROUTE)).toBe('home');
        expect(resolveTvLayer({ page: 'player', overlay: null })).toBe('player');
        expect(resolveTvLayer({ page: 'player', overlay: 'controls' })).toBe('controls');
        expect(resolveTvLayer({ page: 'player', overlay: 'effects' })).toBe('effects');
        expect(resolveTvLayer({ page: 'player', overlay: 'queue' })).toBe('queue');
        expect(resolveTvLayer({ page: 'home', overlay: 'collection' })).toBe('collection');
        expect(resolveTvLayer({ page: 'home', overlay: 'login' })).toBe('login');
        expect(resolveTvLayer({ page: 'home', overlay: 'exit' })).toBe('exit');
    });

    it('closes one layer at a time and opens the leave choice at the home root', () => {
        expect(resolveTvBackRoute({ page: 'home', overlay: 'login' })).toEqual(TV_HOME_ROUTE);
        expect(resolveTvBackRoute({ page: 'home', overlay: 'collection' })).toEqual(TV_HOME_ROUTE);
        expect(resolveTvBackRoute({ page: 'home', overlay: 'exit' })).toEqual(TV_HOME_ROUTE);
        expect(resolveTvBackRoute({ page: 'player', overlay: 'controls' })).toEqual({
            page: 'player',
            overlay: null,
        });
        expect(resolveTvBackRoute({ page: 'player', overlay: 'queue' })).toEqual({
            page: 'player',
            overlay: 'controls',
        });
        expect(resolveTvBackRoute({ page: 'player', overlay: 'effects' })).toEqual({
            page: 'player',
            overlay: 'controls',
        });
        expect(resolveTvBackRoute({ page: 'player', overlay: null })).toEqual(TV_HOME_ROUTE);
        expect(resolveTvBackRoute(TV_HOME_ROUTE)).toEqual({
            page: 'home',
            overlay: 'exit',
        });
    });
});
