type NativeStageActions = {
    toggle: () => void;
    next: () => void;
    previous: () => void;
};

let current: NativeStageActions | null = null;

export const registerNativeStageActions = (actions: NativeStageActions): (() => void) => {
    current = actions;
    return () => {
        if (current === actions) current = null;
    };
};

export const runNativeStageControl = (action: string): void => {
    if (action === 'toggle') current?.toggle();
    else if (action === 'next') current?.next();
    else if (action === 'previous') current?.previous();
};
