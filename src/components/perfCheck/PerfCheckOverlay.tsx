import React from 'react';
import { usePerfCheckOverlayStore } from './perfCheckOverlayStore';

// src/components/perfCheck/PerfCheckOverlay.tsx
// 性能检测在安卓上的入口：全屏浮层，跑完或取消就把自己关掉。组件本身按需加载，
// 没点「开始检测」时不会把检测用的那份代码拉进主包。

const PerfCheckApp = React.lazy(() => import('./PerfCheckApp'));

const PerfCheckOverlay: React.FC = () => {
    const open = usePerfCheckOverlayStore(state => state.open);
    const setOpen = usePerfCheckOverlayStore(state => state.setOpen);
    if (!open) return null;
    return (
        <React.Suspense fallback={null}>
            <PerfCheckApp embedded onClose={() => setOpen(false)} />
        </React.Suspense>
    );
};

export default PerfCheckOverlay;
