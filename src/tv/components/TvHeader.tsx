// src/tv/components/TvHeader.tsx

import { LogIn, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const TvHeader = ({
    userName,
    providerLabel,
    isAuthenticated,
    onOpenAccount,
}: {
    userName?: string | null;
    providerLabel: string;
    isAuthenticated: boolean;
    onOpenAccount: () => void;
}) => {
    const { t } = useTranslation();

    return (
        <header className="tv-header">
            <div className="tv-brand">
                <span className="tv-brand-mark">F</span>
                <span>
                    <strong>Folia TV</strong>
                    <small>{t('tv.brandTagline')}</small>
                </span>
            </div>
            <span className="tv-header-hint">{t('tv.home.remoteHint')}</span>
            <button
                type="button"
                className={isAuthenticated ? 'tv-account-chip' : 'tv-account-login'}
                data-tv-focusable="true"
                data-tv-focus-key="home-account"
                onClick={onOpenAccount}
            >
                {isAuthenticated ? <UserRound size={18} /> : <LogIn size={18} />}
                <span>{isAuthenticated ? (userName || t('tv.home.signedIn')) : t('tv.home.login')}</span>
                <small>{providerLabel}</small>
            </button>
        </header>
    );
};

