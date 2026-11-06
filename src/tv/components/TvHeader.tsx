// src/tv/components/TvHeader.tsx

import { LogIn, Search, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const TvHeader = ({
    userName,
    providerLabel,
    isAuthenticated,
    onOpenAccount,
    onOpenSearch,
    children,
}: {
    userName?: string | null;
    providerLabel: string;
    isAuthenticated: boolean;
    onOpenAccount: () => void;
    onOpenSearch: () => void;
    children: ReactNode;
}) => {
    const { t } = useTranslation();
    const accountLabel = isAuthenticated
        ? `${userName || t('tv.home.signedIn')} · ${providerLabel}`
        : `${t('tv.home.login')} · ${providerLabel}`;

    return (
        <header
            className="tv-header"
            data-tv-focus-group="home-header"
            data-tv-focus-axis="horizontal"
        >
            {children}
            <button
                type="button"
                className="tv-search-entry"
                data-tv-focusable="true"
                data-tv-focus-key="home-search"
                onClick={onOpenSearch}
            >
                <Search size={20} />
                <span>{t('tv.search.open')}</span>
            </button>
            <button
                type="button"
                className="tv-account-orb"
                data-tv-focusable="true"
                data-tv-focus-key="home-account"
                onClick={onOpenAccount}
                aria-label={accountLabel}
                title={accountLabel}
            >
                {isAuthenticated ? <UserRound size={18} /> : <LogIn size={18} />}
            </button>
        </header>
    );
};

