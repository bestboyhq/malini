import { tick } from 'svelte';
import type { BrowserBounds, BrowserTabArgs } from '$contract/browser';

import type { BrowserPlacement } from '../../domain/browser-placement';
import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';
import { pictureBrowserPageCommand } from './picture-browser-page.command';

export { placeBrowserViewCommand };

function placeBrowserViewCommand(tab: BrowserTabArgs, placement: BrowserPlacement): void {
	const turn = browserViewStore.place(browserTabKey(tab), placement);
	if (turn === null) return;
	if (placement.kind === 'shown') void show(tab, placement.bounds);
	else if (placement.kind === 'covered') void cover(tab, turn);
	else if (placement.kind === 'overlapped') void overlap(tab, turn);
	else void hideView(tab);
}

async function show(tab: BrowserTabArgs, bounds: BrowserBounds): Promise<void> {
	try {
		await browserService.show(tab, bounds);
	} catch {
		return;
	}
	if (browserViewStore.snapshots[browserTabKey(tab)] === undefined) pictureBrowserPageCommand(tab);
}

async function cover(tab: BrowserTabArgs, turn: number): Promise<void> {
	const snapshot = await browserService.cover(tab).catch(() => null);
	if (snapshot === null || !browserViewStore.isLatest(browserTabKey(tab), turn)) return;
	browserViewStore.setSnapshot(browserTabKey(tab), snapshot);
}

async function overlap(tab: BrowserTabArgs, turn: number): Promise<void> {
	const snapshot = await browserService.snapshot(tab).catch(() => null);
	if (!browserViewStore.isLatest(browserTabKey(tab), turn)) return;
	if (snapshot !== null) {
		browserViewStore.setSnapshot(browserTabKey(tab), snapshot);
		await nextPaint();
	}
	if (browserViewStore.isLatest(browserTabKey(tab), turn)) await hideView(tab);
}

async function hideView(tab: BrowserTabArgs): Promise<void> {
	try {
		await browserService.hide(tab);
	} catch {
		return;
	}
}

async function nextPaint(): Promise<void> {
	await tick();
	await nextFrame();
	await nextFrame();
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
