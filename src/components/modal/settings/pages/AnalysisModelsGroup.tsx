import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row } from '../kit';
import {
    modelsPresent, refreshModelAvailability, subscribeModelAvailability,
} from '../../../../services/analysis/modelAvailability';
import {
    downloadAndroidModel, onAndroidModelProgress, verifyAndroidModel,
} from '../../../../services/analysis/androidModelWeights';

// src/components/modal/settings/pages/AnalysisModelsGroup.tsx
// 安卓外壳里的分析模型：两个模型合成一行，一个下载按钮按 Beat This! → HTDemucs 顺序补齐；
// 同一个时间只允许一个下载（busyRef 与原生 downloading 集合双重拦截）。删除入口在「存储」页。

type ModelKey = 'beat_this' | 'htdemucs';
const MODELS: ModelKey[] = ['beat_this', 'htdemucs'];

const AnalysisModelsGroup: React.FC = () => {
    const { t } = useTranslation();
    const present = React.useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent);
    const [busy, setBusy] = React.useState<ModelKey | null>(null);
    const [checking, setChecking] = React.useState(false);
    const [progress, setProgress] = React.useState<Record<string, number>>({});
    const [failed, setFailed] = React.useState(false);
    const [checked, setChecked] = React.useState<boolean | null>(null);
    const busyRef = React.useRef(false);

    React.useEffect(() => onAndroidModelProgress((event) => {
        setProgress(current => ({ ...current, [event.model]: event.percent }));
    }), []);

    const installedOf = (model: ModelKey) => model === 'beat_this' ? present.beat_this : present.htdemucs;
    const allInstalled = installedOf('beat_this') && installedOf('htdemucs');

    const download = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setFailed(false);
        setChecked(null);
        try {
            const force = failed || checked === false;
            for (const model of MODELS) {
                if (installedOf(model) && !force) continue;
                setBusy(model);
                const ok = await downloadAndroidModel(model, force);
                if (!ok) {
                    setFailed(true);
                    break;
                }
            }
            await refreshModelAvailability();
        } finally {
            busyRef.current = false;
            setBusy(null);
            setProgress({});
        }
    };

    const check = async () => {
        if (checking || busyRef.current) return;
        setChecking(true);
        setChecked(null);
        try {
            const results = await Promise.all(MODELS.map(model => verifyAndroidModel(model)));
            setChecked(results.every(result => result?.valid === true));
            await refreshModelAvailability();
        } finally {
            setChecking(false);
        }
    };

    const hint = (() => {
        if (checking) return t('options.modelChecking');
        if (busy) return t('options.modelDownloadingName', {
            name: busy === 'beat_this' ? t('options.modelBeatThis') : t('options.modelHtdemucs'),
            percent: progress[busy] ?? 0,
        });
        if (failed) return t('options.modelDownloadFailed');
        if (checked === true) return t('options.modelCheckValid');
        if (checked === false) return t('options.modelCheckInvalid');
        return allInstalled ? t('options.modelInstalled') : t('options.modelNeedsDownloadAll');
    })();

    return (
        <Row label={t('options.modelAnalysisModels')} hint={hint}>
            <div className="flex items-center gap-2">
                <Button onClick={() => void check()} disabled={checking || busy !== null}>
                    {checking ? t('options.modelChecking') : t('options.modelCheck')}
                </Button>
                {!allInstalled && (
                    <Button onClick={() => void download()} disabled={busy !== null}>
                        {busy
                            ? t('options.modelDownloading', { percent: progress[busy] ?? 0 })
                            : failed || checked === false ? t('options.modelRetry') : t('options.modelDownload')}
                    </Button>
                )}
            </div>
        </Row>
    );
};

export default AnalysisModelsGroup;
