import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Row, Value, type SettingsGroupDef } from '../kit';
import {
    modelsPresent, refreshModelAvailability, subscribeModelAvailability,
} from '../../../../services/analysis/modelAvailability';
import { deleteAndroidModel } from '../../../../services/analysis/androidModelWeights';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';

// src/components/modal/settings/pages/AnalysisModelsStorageGroup.tsx
// 存储页里的分析模型管理：显示两个模型是否已下载，并允许一次删掉。下载在「通用 → 安卓外壳」。

const MODELS = ['beat_this', 'htdemucs'] as const;
const GROUP: SettingsGroupDef = { id: 'analysisModelsStorage', titleKey: 'options.modelStorageTitle' };

const AnalysisModelsStorageGroup: React.FC = () => {
    const { t } = useTranslation();
    const present = React.useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent);
    const [clearing, setClearing] = React.useState(false);
    const any = present.beat_this || present.htdemucs;

    const clear = async () => {
        if (clearing) return;
        setClearing(true);
        try {
            await Promise.all(MODELS.map(model => deleteAndroidModel(model)));
            await refreshModelAvailability();
            setStatusMessage({ type: 'success', text: t('options.modelDeleted') });
        } catch (error) {
            console.warn('[Settings] analysis-models:delete-failed', error);
            setStatusMessage({ type: 'error', text: t('options.modelDeleteFailed') });
        } finally {
            setClearing(false);
        }
    };

    return (
        <Group def={GROUP}>
            <Row label={t('options.modelStorageTitle')} hint={t('options.modelStorageDesc')}>
                <Value>{any ? t('options.modelInstalled') : t('options.modelStorageEmpty')}</Value>
                <Button onClick={() => void clear()} disabled={!any || clearing}>
                    {clearing ? t('options.cacheClearing') : t('options.modelDelete')}
                </Button>
            </Row>
        </Group>
    );
};

export default AnalysisModelsStorageGroup;
