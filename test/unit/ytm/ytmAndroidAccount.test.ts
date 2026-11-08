import { describe, expect, it } from 'vitest';
import { accountFromYtmWebList } from '@/services/onlineMusic/ytm/android/ytmAndroidAccount';

// Real WEB wire fixtures, deliberately not the obsolete flat TV account contract.
const page = (account: unknown) => ({ actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: account }] } }] } }] } } } }] });
describe('WEB account list normalization', () => {
    it('reads the selected account and hashes identity without leaking account tokens or email', async () => {
        const user = await accountFromYtmWebList(page({ isSelected: true, accountName: { simpleText: 'Fixture' }, channelHandle: { simpleText: '@fixture' }, accountPhoto: { thumbnails: [{ url: 'https://example.test/avatar' }] }, accountByline: { simpleText: 'private@example.test' } }));
        expect(user).toMatchObject({ nickname: 'Fixture', avatarUrl: 'https://example.test/avatar' });
        expect(user?.id).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(user)).not.toContain('private@example.test');
    });
    it('rejects the old flat getInfo shape rather than inventing a signed-in account', async () => {
        expect(await accountFromYtmWebList({ account_name: 'Fixture' })).toBeNull();
        expect(await accountFromYtmWebList({})).toBeNull();
    });
});
