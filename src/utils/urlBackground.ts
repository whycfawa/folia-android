import type { UrlBackgroundItem } from '../types';

// src/utils/urlBackground.ts
// Normalizes and validates user-provided webpage backgrounds before storage or rendering.

export const normalizeUrlBackgroundUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.href
            : null;
    } catch {
        return null;
    }
};

const normalizeUrlBackgroundImage = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    // 只接受内联图片：远程图片仍走普通网页 URL，不在这里加载。
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(trimmed) && trimmed.length <= 12 * 1024 * 1024
        ? trimmed
        : null;
};

export const sanitizeUrlBackgroundItem = (value: unknown): UrlBackgroundItem | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const item = value as Partial<UrlBackgroundItem>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const kind = item.kind === 'image' ? 'image' : 'url';
    const url = kind === 'image' ? normalizeUrlBackgroundImage(item.url) : normalizeUrlBackgroundUrl(item.url);

    if (!id || !url) {
        return null;
    }

    const note = typeof item.note === 'string' && item.note.trim()
        ? item.note.trim()
        : kind === 'image' ? '自定义图片' : url;

    return { id, kind, url, note };
};

/** 读取用户选中的图片，压到最长边 1920px 的 JPEG；只保留一张，控制 localStorage 体积。 */
export const readUrlBackgroundImageFile = async (file: File): Promise<{ url: string; note: string } | null> => {
    if (!file.type.startsWith('image/')) return null;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1920 / Math.max(1, bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return null;
        }
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return { url: canvas.toDataURL('image/jpeg', 0.86), note: file.name || '自定义图片' };
    } catch (error) {
        console.warn('[UrlBackground] image read failed', error);
        return null;
    }
};

// An imported list is merged into the current one by id rather than replacing it, so a shared config
// adds backgrounds without taking away the ones already saved here. Both the import plan and the
// import itself call this, so what the confirmation promises is what gets stored.
export const mergeUrlBackgroundList = (
    current: UrlBackgroundItem[],
    incoming: unknown,
): UrlBackgroundItem[] => {
    const merged = new Map(current.map(item => [item.id, { ...item }]));

    if (Array.isArray(incoming)) {
        for (const raw of incoming) {
            const sanitized = sanitizeUrlBackgroundItem(raw);
            if (!sanitized) {
                continue;
            }

            const existing = merged.get(sanitized.id);
            merged.set(sanitized.id, {
                ...(existing ?? { id: sanitized.id }),
                kind: sanitized.kind,
                url: sanitized.url,
                note: sanitized.note,
            });
        }
    }

    return Array.from(merged.values());
};

export const sanitizeUrlBackgroundList = (items: unknown): UrlBackgroundItem[] => {
    if (!Array.isArray(items)) {
        return [];
    }

    const next: UrlBackgroundItem[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
        const sanitized = sanitizeUrlBackgroundItem(item);
        if (!sanitized || seenIds.has(sanitized.id)) {
            continue;
        }

        seenIds.add(sanitized.id);
        next.push(sanitized);
    }

    return next;
};
