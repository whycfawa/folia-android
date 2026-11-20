import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearStatusMessage,
    setStatusMessage,
    useStatusMessageStore,
} from '@/stores/useStatusMessageStore';

// The status channel keeps a skip countdown ("this song is refused; going on in 5 s") until the
// countdown itself ends. Ordinary loading/success chatter and ordinary clears must not take it away;
// only its own skip/cancel, or the play that replaces the song, may.

const prompt = (nonce: number) => ({
    type: 'error' as const,
    text: 'failure.contentRestricted',
    sticky: true,
    persistent: true,
    nonce,
    countdown: { text: 'failure.skipCountdown', seconds: 5, totalMs: 5000 },
    actionLabel: 'status.skipUnavailableAction',
    cancelLabel: 'status.cancel',
    onAction: () => undefined,
    onCancel: () => undefined,
});

const message = () => useStatusMessageStore.getState().message;

describe('the sticky skip prompt', () => {
    beforeEach(() => {
        useStatusMessageStore.setState({ message: null, held: false });
    });

    it('is not taken away by an ordinary clear', () => {
        setStatusMessage(prompt(1));
        setStatusMessage(null);
        clearStatusMessage();
        expect(message()).toMatchObject({ text: 'failure.contentRestricted', sticky: true });
    });

    it('is not replaced by ordinary loading or success chatter', () => {
        setStatusMessage(prompt(1));
        setStatusMessage({ type: 'info', text: 'status.loadingSong' });
        setStatusMessage({ type: 'success', text: 'status.loadingComplete', durationMs: 850 });
        expect(message()).toMatchObject({ text: 'failure.contentRestricted' });
    });

    it('is cleared by the forced clear its own skip and cancel use', () => {
        setStatusMessage(prompt(1));
        clearStatusMessage(true);
        expect(message()).toBeNull();
    });

    it('gives way to the next prompt of the same kind', () => {
        setStatusMessage(prompt(1));
        setStatusMessage(prompt(2));
        expect(message()).toMatchObject({ nonce: 2 });
    });
});
