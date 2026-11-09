import { registerPlugin } from '@capacitor/core';

// src/services/onlineMusic/ytm/android/ytmNativePlugin.ts
// FoliaYtm 原生插件的唯一注册点。@capacitor/core 的 JS 侧同名插件只许注册一次（第二次会打
// 「already registered」警告并复用旧 proxy），所以登录与会话存取两个模块都从这里取，不各自注册。

/** 登录屏交回的会话盒子；字段形状由各调用方自己再校验一遍。 */
export type YtmNativeBox = {
    ok?: unknown;
    session?: { cookie?: unknown; userAgent?: unknown } | null;
    error?: { code?: unknown; message?: unknown };
};

export type FoliaYtmNative = {
    signIn(options: { title: string; cancelLabel: string; doneLabel: string }): Promise<YtmNativeBox>;
    restoreSession(): Promise<YtmNativeBox>;
    saveSession(options: { cookie: string; userAgent: string }): Promise<YtmNativeBox>;
    clearSession(options?: { eraseCookies: boolean }): Promise<YtmNativeBox>;
};

export const foliaYtm = registerPlugin<FoliaYtmNative>('FoliaYtm');
