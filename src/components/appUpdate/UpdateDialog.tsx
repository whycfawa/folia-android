import React from 'react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';
import { SheetButton } from '../shared/Sheet';
import { useAppUpdateStore } from '../../stores/useAppUpdateStore';

// src/components/appUpdate/UpdateDialog.tsx
// 应用内更新弹窗。外框用项目共享的 ThemedDialog/Sheet：Esc、焦点、主题和明暗都在那里；
// 强制更新时把关闭路径整条禁掉，用户只剩「下载并安装」。

const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const UpdateDialog: React.FC = () => {
    const { t } = useTranslation();
    const { status, update, decision, progress, error, dismiss, download, install, openInstallSettings } = useAppUpdateStore();
    const open = Boolean(update) && status !== 'idle' && status !== 'checking';
    if (!open || !update) return null;

    const forced = decision === 'forced';
    const size = formatBytes(update.size);
    const description = t('appUpdate.versionLine', { version: update.versionName }) + (size ? ' · ' + size : '');

    const footer = (
        <>
            {status === 'available' && !forced && (
                <SheetButton onClick={dismiss}>{t('appUpdate.later')}</SheetButton>
            )}
            {status === 'available' && (
                <SheetButton variant="primary" onClick={() => void download()}>{t('appUpdate.download')}</SheetButton>
            )}
            {status === 'downloaded' && (
                <SheetButton variant="primary" onClick={() => void install()}>{t('appUpdate.install')}</SheetButton>
            )}
            {status === 'needs-permission' && (
                <>
                    <SheetButton onClick={() => void openInstallSettings()}>{t('appUpdate.openInstallSetting')}</SheetButton>
                    <SheetButton variant="primary" onClick={() => void install()}>{t('appUpdate.install')}</SheetButton>
                </>
            )}
            {status === 'failed' && (
                <SheetButton variant="primary" onClick={() => void download()}>{t('appUpdate.retry')}</SheetButton>
            )}
        </>
    );

    const footerNote = status === 'downloading'
        ? t('appUpdate.downloading', { percent: Math.round(progress) })
        : status === 'installing'
            ? t('appUpdate.installing')
            : forced
                ? t('appUpdate.forcedHint')
                : undefined;

    return (
        <ThemedDialog
            isOpen={open}
            onClose={dismiss}
            closeDisabled={forced}
            closeDisabledTitle={forced ? t('appUpdate.forcedHint') : undefined}
            title={forced ? t('appUpdate.titleForced') : t('appUpdate.title')}
            description={description}
            size="m"
            footer={footer}
            footerNote={footerNote}
        >
            <div className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-[21px] text-[color:var(--st-t2)]">
                {update.notes.trim() || t('appUpdate.noNotes')}
            </div>
            {status === 'downloading' && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--st-fill2)]">
                    <div className="h-full rounded-full bg-[var(--st-accent)] transition-[width]" style={{ width: progress + '%' }} />
                </div>
            )}
            {error && (status === 'failed' || status === 'needs-permission') && (
                <p className="mt-3 whitespace-pre-line break-words text-[12px] leading-snug text-[color:var(--st-err)]">{error}</p>
            )}
        </ThemedDialog>
    );
};

export default UpdateDialog;
