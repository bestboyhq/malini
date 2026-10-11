import { tick } from 'svelte';
import type { BrowserBounds } from '$contract/browser';

import type { BrowserPlacement } from '../../domain/browser-placement';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { placeBrowserViewCommand };

function placeBrowserViewCommand(workstreamId: string, placement: BrowserPlacement): void {
	const turn = browserViewStore.place(workstreamId, placement);
	if (turn === null) return;
	if (placement.kind === 'shown') void show(workstreamId, placement.bounds, turn);
	else if (placement.kind === 'covered') void cover(workstreamId, turn);
	else void hide(workstreamId);
}

async function show(workstreamId: string, bounds: BrowserBounds, turn: number): Promise<void> {
	try {
		await browserService.show(workstreamId, bounds);
	} catch {
		return;
	}
	if (!browserViewStore.isLatest(workstreamId, turn)) return;
	browserViewStore.setSnapshot(workstreamId, null);
}

async function cover(workstreamId: string, turn: number): Promise<void> {
	const snapshot = await paintedSnapshot(workstreamId);
	if (!browserViewStore.isLatest(workstreamId, turn)) return;
	browserViewStore.setSnapshot(workstreamId, snapshot);
	if (snapshot !== null) await nextPaint();
	if (browserViewStore.isLatest(workstreamId, turn)) await hideView(workstreamId);
}

async function hide(workstreamId: string): Promise<void> {
	browserViewStore.setSnapshot(workstreamId, null);
	await hideView(workstreamId);
}

async function paintedSnapshot(workstreamId: string): Promise<string | null> {
	try {
		const snapshot = await browserService.snapshot(workstreamId);
		if (snapshot === null) return null;
		const image = new Image();
		image.src = snapshot;
		await image.decode();
		return snapshot;
	} catch {
		return null;
	}
}

async function hideView(workstreamId: string): Promise<void> {
	try {
		await browserService.hide(workstreamId);
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
