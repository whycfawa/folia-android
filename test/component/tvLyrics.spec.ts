import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
// test/component/tvLyrics.spec.ts

const TV_PATH = '[data-probe-path="tv"]';
const REFERENCE_PATH = '[data-probe-path="reference"]';
const GLOW_WORD = '[data-glow-word]';
const REDUCED_WORD = '[data-glow-word].glow-word-reduced';
const WORD_BODY = '[data-glow-word] > span:not([aria-hidden="true"])';
const GLYPH_GLOW = '[data-glow-word] > [aria-hidden="true"] > span';
const FIRST_LINE_WORDS = ['星光', 'falling', '落在', 'night'];
const SECOND_LINE_WORDS = ['我们', 'rise', '迎着', 'light'];

const readWordStatuses = (path: Locator) => path.locator(GLOW_WORD).evaluateAll(nodes => (
    nodes.map(node => node.getAttribute('data-glow-word'))
));
const readTvWordTexts = (path: Locator) => path.locator(REDUCED_WORD).allTextContents();
const readReferenceWordTexts = (path: Locator) => path.locator(WORD_BODY).allTextContents();
const readClock = async (probe: Locator) => {
    const text = await probe.locator('[data-probe-clock]').textContent();
    return Number(text?.replace('s', ''));
};

test('paused mount and midpoint seek keep the correct word states', async ({ mount }) => {
    const root = await mount('tvLyrics');
    const probe = root.locator('[data-probe-tv-lyrics]');
    const tv = probe.locator(TV_PATH);

    await expect(probe).toHaveAttribute('data-probe-paused', 'true');
    await expect(probe.locator('[data-probe-clock]')).toHaveText('1.000s');
    await expect.poll(() => readTvWordTexts(tv)).toEqual(FIRST_LINE_WORDS);
    await expect.poll(() => readWordStatuses(tv)).toEqual(['passed', 'active', 'waiting', 'waiting']);

    await probe.getByRole('button', { name: 'Seek current line middle' }).click();
    await expect(probe.locator('[data-probe-clock]')).toHaveText('2.000s');
    await expect(probe).toHaveAttribute('data-probe-paused', 'true');
    await expect.poll(() => readWordStatuses(tv)).toEqual(['passed', 'passed', 'active', 'waiting']);
});

test('play and pause move only the MotionValue clock while line controls switch text', async ({ mount, page }) => {
    const root = await mount('tvLyrics');
    const probe = root.locator('[data-probe-tv-lyrics]');
    const tv = probe.locator(TV_PATH);

    await probe.getByRole('button', { name: 'Play lyrics clock' }).click();
    await expect.poll(() => readClock(probe)).toBeGreaterThan(1.08);
    await probe.getByRole('button', { name: 'Pause lyrics clock' }).click();
    await page.waitForTimeout(50);
    const frozenClock = await readClock(probe);
    await page.waitForTimeout(150);
    await expect.poll(() => readClock(probe)).toBe(frozenClock);

    await probe.getByRole('button', { name: 'Next line' }).click();
    await expect(probe.locator('[data-probe-clock]')).toHaveText('4.000s');
    await expect.poll(() => readTvWordTexts(tv)).toEqual(SECOND_LINE_WORDS);
    await probe.getByRole('button', { name: 'Previous line' }).click();
    await expect(probe.locator('[data-probe-clock]')).toHaveText('0.000s');
    await expect.poll(() => readTvWordTexts(tv)).toEqual(FIRST_LINE_WORDS);
});

test('TV word glows stay reduced and the full reference keeps glyph glows', async ({ mount }) => {
    const root = await mount('tvLyrics');
    const probe = root.locator('[data-probe-tv-lyrics]');
    const tv = probe.locator(TV_PATH);

    await expect(tv.locator(GLOW_WORD)).toHaveCount(4);
    await expect(tv.locator(REDUCED_WORD)).toHaveCount(4);
    expect(await tv.locator(GLOW_WORD).evaluateAll(nodes => (
        nodes.every(node => node.children.length === 0)
    ))).toBe(true);
    await expect(tv.locator(GLYPH_GLOW)).toHaveCount(0);

    // Cover both entering and exiting line/body nodes without changing the continuous clock.
    const blurSamples = tv.evaluate(async stage => {
        const badFilters: string[] = [];
        for (let frame = 0; frame < 36; frame += 1) {
            const nodes = stage.querySelectorAll(
                '[class~="max-w-6xl"], [data-glow-word] > span:not([aria-hidden="true"])',
            );
            for (const node of nodes) {
                const filter = getComputedStyle(node).filter;
                if (filter.includes('blur(')) badFilters.push(filter);
            }
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        return badFilters;
    });
    await probe.getByRole('button', { name: 'Next line' }).click();
    await expect.poll(() => readTvWordTexts(tv)).toEqual(SECOND_LINE_WORDS);
    expect(await blurSamples).toEqual([]);

    await probe.getByRole('button', { name: 'Show full reference' }).click();
    const reference = probe.locator(REFERENCE_PATH);
    await expect(reference.locator(GLOW_WORD)).toHaveCount(4);
    await expect(reference).toHaveAttribute('data-probe-theme', 'Music TV Midnight');
    await expect(reference.locator('[data-probe-reference-projection]')).toHaveCount(1);
    await expect.poll(() => readReferenceWordTexts(reference)).toEqual(SECOND_LINE_WORDS);

    const referenceGlyphCount = await reference.locator(GLYPH_GLOW).count();
    const expectedGlyphCount = await reference.locator(WORD_BODY).evaluateAll(nodes => (
        nodes.reduce((total, node) => total + Array.from(node.textContent ?? '').length, 0)
    ));
    expect(referenceGlyphCount).toBe(expectedGlyphCount);
    expect(referenceGlyphCount).toBeGreaterThan(4);
});

test('Partita chunks are visible when mounted or sought while paused', async ({ mount }) => {
    const root = await mount('tvLyrics', { mode: 'partita' });
    const tv = root.locator(TV_PATH);
    await expect(tv.locator(REDUCED_WORD)).toHaveCount(4);
    await expect.poll(() => readWordStatuses(tv)).toEqual(['passed', 'active', 'waiting', 'waiting']);
    const activeChunkOpacity = () => tv.locator('[data-glow-word="active"]').evaluate(word => (
        Number(getComputedStyle(word.closest('.inline-flex')!).opacity)
    ));
    await expect.poll(activeChunkOpacity).toBeGreaterThan(0.9);
    await root.getByRole('button', { name: 'Next line' }).click();
    await expect.poll(() => readTvWordTexts(tv)).toEqual(SECOND_LINE_WORDS);
    await expect.poll(activeChunkOpacity).toBeGreaterThan(0.9);
    await expect(tv.locator(GLYPH_GLOW)).toHaveCount(0);
});
