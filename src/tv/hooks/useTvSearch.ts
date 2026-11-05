import { useCallback, useEffect, useRef, useState } from 'react';
import { omni } from '../../services/onlineMusic/omni';
import type { UnifiedSong } from '../../types';

// src/tv/hooks/useTvSearch.ts
// 遥控器搜索只保留一页结果，输入停止后再发请求；每次输入或提交都会作废旧应答。

const TV_SEARCH_DEBOUNCE_MS = 320;
const TV_SEARCH_LIMIT = 40;

export type TvSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export type TvSearchModel = {
    query: string;
    submittedQuery: string;
    results: UnifiedSong[];
    status: TvSearchStatus;
    setQuery: (query: string) => void;
    submit: () => void;
    retry: () => void;
};

export const useTvSearch = (): TvSearchModel => {
    const [query, setQueryState] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [results, setResults] = useState<UnifiedSong[]>([]);
    const [status, setStatus] = useState<TvSearchStatus>('idle');
    const requestRef = useRef(0);
    const debounceRef = useRef<number | null>(null);

    const runSearch = useCallback(async (rawQuery: string) => {
        const nextQuery = rawQuery.trim();
        const requestId = ++requestRef.current;
        if (!nextQuery) {
            setSubmittedQuery('');
            setResults([]);
            setStatus('idle');
            return;
        }

        setSubmittedQuery(nextQuery);
        setStatus('loading');
        try {
            const page = await omni.searchSongs(nextQuery, {
                limit: TV_SEARCH_LIMIT,
                offset: 0,
            });
            if (requestRef.current !== requestId) return;
            setResults(page.items);
            setStatus('ready');
        } catch (error) {
            if (requestRef.current !== requestId) return;
            console.warn('[TV Search] Search failed', error);
            setResults([]);
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        requestRef.current += 1;
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);

        const nextQuery = query.trim();
        if (!nextQuery) {
            debounceRef.current = null;
            setSubmittedQuery('');
            setResults([]);
            setStatus('idle');
            return undefined;
        }

        setStatus('loading');
        debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null;
            void runSearch(nextQuery);
        }, TV_SEARCH_DEBOUNCE_MS);
        return () => {
            if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        };
    }, [query, runSearch]);

    useEffect(() => () => {
        requestRef.current += 1;
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    }, []);

    const setQuery = useCallback((nextQuery: string) => {
        setQueryState(nextQuery);
    }, []);

    const submit = useCallback(() => {
        if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        void runSearch(query);
    }, [query, runSearch]);

    const retry = useCallback(() => {
        void runSearch(submittedQuery || query);
    }, [query, runSearch, submittedQuery]);

    return {
        query,
        submittedQuery,
        results,
        status,
        setQuery,
        submit,
        retry,
    };
};
