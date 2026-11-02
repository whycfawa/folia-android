import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row } from '../kit';
import {
    modelsPresent, refreshModelAvailability, subscribeModelAvailability,
} from '../../../../services/analysis/modelAvailability';
import {
    deleteAndroidModel, downloadAndroidModel, onAndroidModelProgress, type AndroidModelName,
} from '../../../../services/analysis/androidModelWeights';

// src/components/modal/settings/pages/AnalysisModelsGroup.tsx
// 安卓外壳里的分析模型管理：Beat This! 与 HTDemucs 都按需下载，这里给下载、进度和删除。
// 权重不再随 APK 打包；下载完成刷新 modelAvailability，歌词动感设置里的“需要下载”随之消失。

type ModelKey = 'beat_this' | 'htdemucs';

const ROWS: { model: ModelKey; labelKey: string; size: string }[] = [
    { model: 'beat_this', labelKey: 'options.modelBeatThis', size: '40 MB' },
    { model: 'htdemucs', labelKey: 'options.modelHtdemucs', size: '88 MB' },
];

const AnalysisModelsGroup: React.FC = () => {
    const { t } = useTranslation();
    const present = React.useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent);
    const [busy, setBusy] = React.useState<ModelKey | null>(null);
    const [progress, setProgress] = React.useState<Record<string, number>>({});
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => onAndroidModelProgress((event) => {
        setProgress(current => ({ ...current, [event.model]: event.percent }));
    }), []);

    const download = async (model: ModelKey) => {
        setBusy(model);
        setFailed(false);
        try {
            const ok = await downloadAndroidModel(model);
            if (!ok) setFailed(true);
            await refreshModelAvailability();
        } finally {
            setBusy(null);
            setProgress(current => {
                const next = { ...current };
                delete next[model];
                return next;
            });
        }
    };

    const remove = async (model: ModelKey) => {
        setBusy(model);
        setFailed(false);
        try {
            await deleteAndroidModel(model);
            await refreshModelAvailability();
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            {ROWS.map(({ model, labelKey, size }) => {
                const installed = model === 'beat_this' ? present.beat_this : present.htdemucs;
                const percent = progress[model];
                const working = busy === model;
                return (
                    <Row
                        key={model}
                        label={t(labelKey)}
                        hint={working
                            ? t('options.modelDownloading', { percent: percent ?? 0 })
                            : installed ? t('options.modelInstalled') : t('options.modelNeedsDownload', { size })}
                    >
                        {installed ? (
                            <Button onClick={() => void remove(model)} disabled={busy !== null}>
                                {t('options.modelDelete')}
                            </Button>
                        ) : (
                            <Button onClick={() => void download(model)} disabled={busy !== null}>
                                {working ? t('options.modelDownloading', { percent: percent ?? 0 }) : t('options.modelDownload')}
                            </Button>
                        )}
                    </Row>
                );
            })}
            {failed && <Row notice={t('options.modelDownloadFailed')} />}
        </>
    );
};

export default AnalysisModelsGroup;
