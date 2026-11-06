import type { ProviderUser } from '../../../../types/onlineMusic';

// Normalize WEB accounts_list without exposing email addresses or raw account tokens.
const text = (value: any): string => typeof value === 'string' ? value
    : typeof value?.simpleText === 'string' ? value.simpleText
        : Array.isArray(value?.runs) ? value.runs.map((run: any) => run?.text ?? '').join('') : '';

export const accountFromYtmWebList = async (data: any): Promise<ProviderUser | null> => {
    const accounts: any[] = [];
    for (const action of data?.actions ?? []) {
        for (const section of action?.getMultiPageMenuAction?.menu?.multiPageMenuRenderer?.sections ?? []) {
            for (const group of section?.accountSectionListRenderer?.contents ?? []) {
                for (const entry of group?.accountItemSectionRenderer?.contents ?? []) {
                    if (entry?.accountItem) accounts.push(entry.accountItem);
                }
            }
        }
    }
    const selected = accounts.find(account => account.isSelected) ?? accounts[0];
    const nickname = text(selected?.accountName);
    if (!nickname) return null;
    const tokens = selected?.serviceEndpoint?.selectActiveIdentityEndpoint?.supportedTokens ?? [];
    const identity = tokens.map((token: any) => token?.accountStateToken?.obfuscatedGaiaId)
        .find((value: unknown) => typeof value === 'string' && value) ?? (text(selected?.channelHandle) || nickname);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const avatarUrl = selected?.accountPhoto?.thumbnails?.at(-1)?.url;
    return { id, nickname, ...(typeof avatarUrl === 'string' ? { avatarUrl } : {}) };
};
