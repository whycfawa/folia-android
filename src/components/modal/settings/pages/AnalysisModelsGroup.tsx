import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row } from '../kit';
import {
    modelsPresent, refreshModelAvailability, subscribeModelAvailability,
} from '../../../../services/analysis/modelAvailability';
import {
    deleteAndroidModel, downloadAndroidModel, onAndroidModelProgress, verifyAndroidModel,
    type AndroidModelName,
} from '../../../../services/analysis/androidModelWeights';

// src/components/modal/settings/pages/AnalysisModelsGroup.tsx
// 安卓外壳里的分析模型管理：Beat This! 与 HTDemucs 都按需下载，这里给检测、下载、进度、重试和删除。
// 同一个模型同时只允许一个下载（UI 的 busy 与原生 downloading 集合双重拦截）。

type ModelKey = 'beat_this' | 'htdemucs';

const ROWS: { model: ModelKey; labelKey: string; size: string }[] = [
    { model: 'beat_this', labelKey: 'options.modelBeatThis', size: '40 MB' },
    { model: 'htdemucs', labelKey: 'options.modelHtdemucs', size: '88 MB' },
];

type CheckState = { installed: boolean; valid: boolean };

const AnalysisModelsGroup: React.FC = () => {
    const { t } = useTranslation();
    const present = React.useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent);
    const [busy, setBusy] = React.useState<ModelKey | null>(null);
    const [checking, setChecking] = React.useState<ModelKey | null>(null);
    const [progress, setProgress] = React.useState<Record<string, number>>({});
    const [failed, setFailed] = React.useState<ModelKey | null>(null);
    const [checked, setChecked] = React.useState<Partial<Record<ModelKey, CheckState>>>({});
    const busyRef = React.useRef<ModelKey | null>(null);

    React.useEffect(() => onAndroidModelProgress((event) => {
        setProgress(current => ({ ...current, [event.model]: event.percent }));
    }), []);

    const download = async (model: ModelKey, force = false) => {
        // 连点、两个按钮同时点：同一时间只让一个下载进入原生。
        if (busyRef.current) return;
        busyRef.current = model;
        setBusy(model);
        setFailed(null);
        setChecked(current => {
            const next = { ...current };
            delete next[model];
            return next;
        });
        try {
            const ok = await downloadAndroidModel(model, force);
            if (!ok) setFailed(model);
            await refreshModelAvailability();
        } finally {
            busyRef.current = null;
            setBusy(null);
            setProgress(current => {
                const next = { ...current };
                delete next[model];
                return next;
            });
        }
    };

    const remove = async (model: ModelKey) => {
        if (busyRef.current) return;
        busyRef.current = model;
        setBusy(model);
        setFailed(null);
        try {
            await deleteAndroidModel(model);
            await refreshModelAvailability();
            setChecked(current => {
                const next = { ...current };
                delete next[model];
                return next;
            });
        } finally {
            busyRef.current = null;
            setBusy(null);
        }
    };

    const check = async (model: ModelKey) => {
        if (checking || busyRef.current) return;
        setChecking(model);
        try {
            const answer = await verifyAndroidModel(model);
            if (answer) {
                setChecked(current => ({ ...current, [model]: { installed: answer.installed, valid: answer.valid } }));
            }
            await refreshModelAvailability();
        } finally {
            setChecking(null);
        }
    };

    const hintFor = (model: ModelKey, installed: boolean, size: string, percent: number | undefined): string => {
        if (checking === model) return t('options.modelChecking');
        if (busy === model) return t('options.modelDownloading', { percent: percent ?? 0 });
        if (failed === model) return t('options.modelDownloadFailed');
        const state = checked[model];
        if (state) return state.valid ? t('options.modelCheckValid') : t('options.modelCheckInvalid');
        return installed ? t('options.modelInstalled') : t('options.modelNeedsDownload', { size });
    };

    return (
        <>
            {ROWS.map(({ model, labelKey, size }) => {
                const installed = model === 'beat_this' ? present.beat_this : present.htdemucs;
                const percent = progress[model];
                const working = busy === model;
                const checkingThis = checking === model;
                const invalid = checked[model]?.valid === false;
                return (
                    <Row key={model} label={t(labelKey)} hint={hintFor(model, installed, size, percent)}>
                        <div className="flex items-center gap-2">
                            <Button onClick={() => void check(model)} disabled={checking !== null || busy !== null}>
                                {checkingThis ? t('options.modelChecking') : t('options.modelCheck')}
                            </Button>
                            {installed && !invalid && (
                                <Button onClick={() => void remove(model)} disabled={busy !== null}>
                                    {t('options.modelDelete')}
                                </Button>
                            )}
                            {(!installed || invalid) && (
                                <Button
                                    onClick={() => void download(model, invalid)}
                                    disabled={busy !== null}
                                >
                                    {working
                                        ? t('options.modelDownloading', { percent: percent ?? 0 })
                                        : failed === model ? t('options.modelRetry') : t('options.modelDownload')}
                                </Button>
                            )}
                        </div>
                    </Row>
                );
            })}
        </>
    );
};

export default AnalysisModelsGroup;
