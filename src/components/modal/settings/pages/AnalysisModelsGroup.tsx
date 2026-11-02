import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row } from '../kit';
import {
    modelsPresent, refreshModelAvailability, subscribeModelAvailability,
} from '../../../../services/analysis/modelAvailability';
import {
    downloadAndroidModel, importAndroidModels, onAndroidModelProgress, readAndroidModelDownloadStatus, verifyAndroidModel,
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
    const [importing, setImporting] = React.useState(false);
    const [importFailed, setImportFailed] = React.useState(false);
    const [checked, setChecked] = React.useState<boolean | null>(null);
    const busyRef = React.useRef(false);

    React.useEffect(() => onAndroidModelProgress((event) => {
        setProgress(current => ({ ...current, [event.model]: event.percent }));
    }), []);

    // 页面切走再回来：原生下载还在跑，按 status 恢复 busy 与百分比，别显示成“重新下载”。
    React.useEffect(() => {
        let cancelled = false;
        void (async () => {
            const status = await readAndroidModelDownloadStatus();
            if (!cancelled && status) {
                const active = MODELS.find(model => status[model]?.downloading);
                if (active) {
                    busyRef.current = true;
                    setBusy(active);
                    setProgress(current => ({ ...current, [active]: status[active]?.percent ?? 0 }));
                }
            }
            await refreshModelAvailability();
        })();
        return () => { cancelled = true; };
    }, []);

    // 恢复出来的下载没有本组件的 Promise 可等：轮询 status，结束后刷新模型可用性。
    React.useEffect(() => {
        if (!busy) return;
        let cancelled = false;
        const tick = async () => {
            const status = await readAndroidModelDownloadStatus();
            if (cancelled) return;
            const current = status?.[busy];
            if (current?.downloading) {
                setProgress(progressNow => ({ ...progressNow, [busy]: current.percent }));
                return;
            }
            busyRef.current = false;
            setBusy(null);
            setProgress({});
            await refreshModelAvailability();
        };
        const timer = window.setInterval(() => void tick(), 800);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [busy]);

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

    const importFiles = async () => {
        if (importing || busyRef.current) return;
        setImporting(true);
        setImportFailed(false);
        try {
            const result = await importAndroidModels();
            if (!result.canceled && (result.failed.length > 0 || result.imported.length === 0)) {
                setImportFailed(true);
            }
            if (result.imported.length > 0) {
                setFailed(false);
                setChecked(null);
            }
            await refreshModelAvailability();
        } finally {
            setImporting(false);
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
        if (importing) return t('options.modelImporting');
        if (importFailed) return t('options.modelImportFailed');
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
                <Button onClick={() => void check()} disabled={checking || busy !== null || importing}>
                    {checking ? t('options.modelChecking') : t('options.modelCheck')}
                </Button>
                <Button onClick={() => void importFiles()} disabled={importing || busy !== null}>
                    {importing ? t('options.modelImporting') : t('options.modelImport')}
                </Button>
                {!allInstalled && (
                    <Button onClick={() => void download()} disabled={busy !== null || importing}>
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
