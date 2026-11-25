import { describe, expect, it } from 'vitest';
import { mergeOperationParams } from '@/nativeBridge/api/folia.js';

// test/unit/nativeBridge/bridgeOperationParams.test.ts
//
// 现场「收藏添加失败」：androidBridgeFetch 把写入请求的正文 JSON.stringify 后放在 input.body
// （字符串），桥只在 body 是对象时才往参数里并，字符串被整段丢掉。于是 QQ 红心拿不到
// song/liked，判成 bad input 回 UNSUPPORTED，界面提示「不支持对这首歌这样操作」。
// 这里钉住「字符串正文也要解开」以及优先级：query < params < 正文。

const urlOf = (path: string): URL => new URL(path, 'https://folia.local');

describe('mergeOperationParams', () => {
    it('unpacks a JSON string body, the shape androidBridgeFetch sends', () => {
        const params = mergeOperationParams(
            { body: JSON.stringify({ song: { id: 123456, mid: 'SONGMID', type: 0 }, liked: true }) },
            urlOf('/user/song/like'),
        );
        expect(params).toEqual({ song: { id: 123456, mid: 'SONGMID', type: 0 }, liked: true });
    });

    it('unpacks a JSON string body for playlist writes too', () => {
        const params = mergeOperationParams(
            { body: JSON.stringify({ tid: '123', op: 'add', songs: '[1,2]' }) },
            urlOf('/user/playlist/tracks'),
        );
        expect(params).toMatchObject({ tid: '123', op: 'add', songs: '[1,2]' });
    });

    it('still takes an object body as before', () => {
        const params = mergeOperationParams(
            { body: { listid: '88', data: 'HASH|NAME|1|2' } },
            urlOf('/playlist/tracks/add'),
        );
        expect(params).toMatchObject({ listid: '88', data: 'HASH|NAME|1|2' });
    });

    it('lets query and params go, the body wins where they overlap', () => {
        const params = mergeOperationParams(
            { params: { liked: 'query-params', extra: 'kept' }, body: JSON.stringify({ liked: true }) },
            urlOf('/user/song/like?liked=query&id=7'),
        );
        expect(params).toEqual({ id: '7', extra: 'kept', liked: true });
    });

    it('leaves the query alone when the body is not JSON', () => {
        expect(mergeOperationParams({ body: '<html>' }, urlOf('/like?id=7&like=true')))
            .toEqual({ id: '7', like: 'true' });
    });

    it('ignores an array body', () => {
        expect(mergeOperationParams({ body: '[1,2]' }, urlOf('/like?id=7'))).toEqual({ id: '7' });
    });
});
