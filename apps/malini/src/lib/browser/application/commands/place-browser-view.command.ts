import { tick } from 'svelte';
import type { BrowserBounds, BrowserTabArgs } from '$contract/browser';

import type { BrowserPlacement } from '../../domain/browser-placement';
import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { placeBrowserViewCommand };

function placeBrowserViewCommand(tab: BrowserTabArgs, placement: BrowserPlacement): void {
	const turn = browserViewStore.place(browserTabKey(tab), placement);
	if (turn === null) return;
	if (placement.kind === 'shown') void show(tab, placement.bounds, turn);
	else if (placement.kind === 'covered') void cover(tab, turn);
	else void hide(tab);
}

async function show(tab: BrowserTabArgs, bounds: BrowserBounds, turn: number): Promise<void> {
	try {
		await browserService.show(tab, bounds);
	} catch {
		return;
	}
	if (!browserViewStore.isLatest(browserTabKey(tab), turn)) return;
	browserViewStore.setSnapshot(browserTabKey(tab), null);
}

async function cover(tab: BrowserTabArgs, turn: number): Promise<void> {
	const snapshot = await paintedSnapshot(tab);
	if (!browserViewStore.isLatest(browserTabKey(tab), turn)) return;
	browserViewStore.setSnapshot(browserTabKey(tab), snapshot);
	if (snapshot !== null) await nextPaint();
	if (browserViewStore.isLatest(browserTabKey(tab), turn)) await hideView(tab);
}

async function hide(tab: BrowserTabArgs): Promise<void> {
	browserViewStore.setSnapshot(browserTabKey(tab), null);
	await hideView(tab);
}

async function paintedSnapshot(tab: BrowserTabArgs): Promise<string | null> {
	try {
		const snapshot = await browserService.snapshot(tab);
		if (snapshot === null) return null;
		const image = new Image();
		image.src = snapshot;
		await image.decode();
		return snapshot;
	} catch {
		return null;
	}
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
