// src/tv/components/TvLoginOverlay.tsx

import { Check, Loader2, QrCode, RefreshCw, ServerCog, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountSummary } from '../../types/onlineMusic';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { TvAccountModel } from '../hooks/useTvAccount';

const errorMessage = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);

export const TvLoginOverlay = ({
    account,
    startError,
    onClose,
    onSwitchConfirmed,
}: {
    account: TvAccountModel;
    startError: string | null;
    onClose: () => void;
    onSwitchConfirmed: () => void;
}) => {
    const { t } = useTranslation();
    const compactProviderStrip = useMediaQuery('(max-width: 600px)');
    const [actionError, setActionError] = useState<string | null>(null);
    const login = account.login;
    const pendingSwitch = account.pendingSwitch;
    const session = login?.session ?? null;
    const choosingMethod = session?.phase === 'choosing-method';
    const backendFailure = login?.backendFailure ?? null;
    const qrImageUrl = session?.qrImageUrl ?? '';
    const isLoadingQr = !session
        || session.phase === 'resolving-methods'
        || session.phase === 'loading'
        || (!qrImageUrl && !choosingMethod && !backendFailure && !login?.canRetry);
    const canRetry = Boolean(login?.canRetry) && !backendFailure && !choosingMethod;
    const restarting = Boolean(session?.backend.restarting);

    const selectProvider = async (provider: ProviderAccountSummary) => {
        if (!provider.availability.configured) return;
        setActionError(null);
        try {
            await account.selectProvider(provider.providerId);
        } catch (error) {
            setActionError(errorMessage(error));
        }
    };

    const confirmSwitch = async () => {
        if (!pendingSwitch) return;
        setActionError(null);
        try {
            const result = await account.confirmSwitch(pendingSwitch.request.id);
            if (result.status === 'confirmed') onSwitchConfirmed();
        } catch (error) {
            setActionError(errorMessage(error));
        }
    };

    const cancelSwitch = () => {
        if (!pendingSwitch) return;
        setActionError(null);
        account.cancelSwitch(pendingSwitch.request.id);
    };

    const providerStatus = (provider: ProviderAccountSummary): string => {
        if (!provider.availability.configured) return t('home.providerNotConfigured');
        if (provider.requiresAccount === false) return t('tv.account.noAccount');
        if (provider.user) return provider.user.nickname || t('tv.account.signedIn');
        return t('tv.account.notSignedIn');
    };

    const providerAction = (provider: ProviderAccountSummary): string => {
        if (provider.providerId === account.activeProviderId) return t('tv.account.current');
        if (provider.requiresAccount === false || provider.user) return t('tv.account.switchAction');
        return t('tv.account.loginAction');
    };

    const title = login?.title
        || (pendingSwitch ? pendingSwitch.title : t('tv.account.title'));
    const hint = login?.note
        || (pendingSwitch ? t('tv.account.switchHint') : t('tv.account.hint'));

    return (
        <section id="tv-layer-login" data-tv-layer="login" className="tv-overlay tv-login-overlay">
            <div
                className="tv-overlay-panel tv-login-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-login-title"
            >
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon">
                            {login ? <QrCode size={22} /> : <UserRound size={22} />}
                        </span>
                        <span>
                            <h2 id="tv-login-title">{title}</h2>
                            <small>{hint}</small>
                        </span>
                    </div>
                    <button
                        type="button"
                        data-tv-focusable="true"
                        data-tv-focus-key="login-close"
                        onClick={onClose}
                        aria-label={t('tv.common.close')}
                    >
                        <X size={22} />
                    </button>
                </header>

                <div className="tv-account-layout">
                    <aside className="tv-account-providers" aria-label={t('tv.account.providers')}>
                        <strong className="tv-account-providers-title">{t('tv.account.providers')}</strong>
                        <div
                            className="tv-account-provider-list"
                            data-tv-focus-group="login-providers"
                            data-tv-focus-axis={compactProviderStrip ? 'horizontal' : 'vertical'}
                        >
                            {account.providers.map(provider => {
                                const configured = provider.availability.configured;
                                const active = provider.providerId === account.activeProviderId;
                                return (
                                    <button
                                        key={provider.providerId}
                                        type="button"
                                        className={`tv-provider-option${active ? ' is-active' : ''}${
                                            provider.user ? ' is-signed-in' : ''
                                        }`}
                                        data-tv-focusable="true"
                                        data-tv-focus-key={`login-provider-${provider.providerId}`}
                                        disabled={!configured}
                                        aria-current={active ? 'true' : undefined}
                                        onClick={() => void selectProvider(provider)}
                                    >
                                        <span className="tv-provider-mark" aria-hidden="true">
                                            {provider.shortName?.slice(0, 1)
                                                || provider.displayName.slice(0, 1)
                                                || '•'}
                                        </span>
                                        <span className="tv-provider-copy">
                                            <strong>{provider.shortName || provider.displayName}</strong>
                                            <small>{providerStatus(provider)}</small>
                                        </span>
                                        <span className="tv-provider-action">
                                            {provider.user && <Check size={15} />}
                                            {providerAction(provider)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="tv-account-providers-hint">{t('tv.account.remoteHint')}</p>
                    </aside>

                    <div className="tv-account-detail">
                        {pendingSwitch ? (
                            <div className="tv-account-pending">
                                <span className="tv-overlay-icon"><UserRound size={24} /></span>
                                <strong>{pendingSwitch.title}</strong>
                                <p>{pendingSwitch.description}</p>
                                <div
                                    className="tv-account-pending-actions"
                                    data-tv-focus-group="login-switch-actions"
                                    data-tv-focus-axis="horizontal"
                                >
                                    <button
                                        type="button"
                                        data-tv-focusable="true"
                                        data-tv-focus-key="login-switch-confirm"
                                        onClick={() => void confirmSwitch()}
                                    >
                                        {t('tv.account.switchConfirm')}
                                    </button>
                                    <button
                                        type="button"
                                        data-tv-focusable="true"
                                        data-tv-focus-key="login-switch-cancel"
                                        onClick={cancelSwitch}
                                    >
                                        {t('tv.account.switchCancel')}
                                    </button>
                                </div>
                                {(actionError || startError) && (
                                    <small className="tv-account-error">{actionError || startError}</small>
                                )}
                            </div>
                        ) : choosingMethod && login?.methodStep ? (
                            <div className="tv-login-methods">
                                <strong>{login.methodStep.title}</strong>
                                <p>{login.methodStep.hint}</p>
                                <div className="tv-login-method-grid">
                                    {login.methodStep.options.map(option => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            data-tv-focusable="true"
                                            data-tv-focus-key={`login-method-${option.id}`}
                                            onClick={() => void account.selectLoginMethod(option.id)}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : login ? (
                            <div className="tv-login-body">
                                <div className="tv-login-qr">
                                    {backendFailure ? (
                                        <span className="tv-login-qr-failure">
                                            <ServerCog size={42} />
                                            <strong>{backendFailure.title}</strong>
                                        </span>
                                    ) : qrImageUrl ? (
                                        <img src={qrImageUrl} alt="" />
                                    ) : (
                                        <span className="tv-login-qr-loading">
                                            {isLoadingQr ? <Loader2 size={34} className="tv-spin" /> : <QrCode size={42} />}
                                        </span>
                                    )}
                                </div>
                                <div className="tv-login-status">
                                    <strong>
                                        {actionError
                                            || startError
                                            || login.status
                                            || (backendFailure ? backendFailure.title : t('tv.login.waiting'))}
                                    </strong>
                                    <p>{session?.backend.failed ? session.backend.detail : login.note}</p>
                                    <div className="tv-login-actions">
                                        {backendFailure && (
                                            <button
                                                type="button"
                                                data-tv-focusable="true"
                                                data-tv-focus-key="login-restart"
                                                disabled={restarting}
                                                onClick={() => void account.restartLoginBackend()}
                                            >
                                                {restarting ? <Loader2 size={18} className="tv-spin" /> : <ServerCog size={18} />}
                                                {restarting ? backendFailure.restartingLabel : backendFailure.restartLabel}
                                            </button>
                                        )}
                                        {canRetry && (
                                            <button
                                                type="button"
                                                data-tv-focusable="true"
                                                data-tv-focus-key="login-retry"
                                                onClick={() => void account.retryLogin()}
                                            >
                                                <RefreshCw size={18} />
                                                {login.retryLabel}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="tv-account-intro">
                                <span className="tv-overlay-icon"><UserRound size={24} /></span>
                                <strong>{account.providerLabel}</strong>
                                <p>
                                    {account.isAuthenticated
                                        ? t('tv.account.signedInHint')
                                        : t('tv.account.chooseHint')}
                                </p>
                                {!account.isAuthenticated && account.activeProvider?.availability.configured && (
                                    <button
                                        type="button"
                                        data-tv-focusable="true"
                                        data-tv-focus-key="login-start-current"
                                        onClick={() => {
                                            if (account.activeProvider) void selectProvider(account.activeProvider);
                                        }}
                                    >
                                        <QrCode size={18} />
                                        {t('tv.account.loginAction')}
                                    </button>
                                )}
                                {(actionError || startError) && (
                                    <small className="tv-account-error">{actionError || startError}</small>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
