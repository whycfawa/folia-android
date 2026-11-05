type NativeStageActions = {
    toggle: () => void;
    next: () => void;
    previous: () => void;
    seek: (fraction: number) => void;
};

let current: NativeStageActions | null = null;

export const registerNativeStageActions = (actions: NativeStageActions): (() => void) => {
    current = actions;
    return () => {
        if (current === actions) current = null;
    };
};

export const runNativeStageControl = (action: string, value = 0): void => {
    if (action === 'toggle') current?.toggle();
    else if (action === 'next') current?.next();
    else if (action === 'previous') current?.previous();
    else if (action === 'seek') current?.seek(value);
};
