import { onDestroy, onMount } from 'svelte';
import {
	router,
	type AfterNavigate,
	type BeforeNavigate,
	type GotoOptions,
	type Navigation,
	type PageState,
} from './hash-router.svelte';

export function goto(url: string | URL, options?: GotoOptions): Promise<void> {
	return router.goto(url, options);
}

export function afterNavigate(callback: (navigation: AfterNavigate) => void): () => void {
	const unsubscribe = router.afterNavigate(callback);
	bindToComponent(unsubscribe, () => {
		callback({
			from: null,
			to: { url: router.page.url, params: router.page.params, route: router.page.route },
			type: 'enter',
			willUnload: false,
			complete: Promise.resolve(),
		});
	});
	return unsubscribe;
}

export function beforeNavigate(callback: (navigation: BeforeNavigate) => void): () => void {
	const unsubscribe = router.beforeNavigate(callback);
	bindToComponent(unsubscribe);
	return unsubscribe;
}

export function onNavigate(callback: (navigation: Navigation) => void | Promise<void>): () => void {
	const unsubscribe = router.onNavigate(callback);
	bindToComponent(unsubscribe);
	return unsubscribe;
}

export function preloadCode(...urls: readonly (string | URL)[]): Promise<void> {
	return router.preload(...urls);
}

export async function preloadData(
	url: string | URL,
): Promise<{ type: 'loaded'; status: number; data: Record<string, never> }> {
	await router.preload(url);
	return { type: 'loaded', status: 200, data: {} };
}

export function pushState(url: string | URL | '', state: PageState): void {
	router.pushState(url, state);
}

export function replaceState(url: string | URL | '', state: PageState): void {
	router.replaceState(url, state);
}

export function invalidate(_resource: string | URL | ((url: URL) => boolean)): Promise<void> {
	return Promise.resolve();
}

export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}

export function disableScrollHandling(): void {}

function bindToComponent(unsubscribe: () => void, mounted?: () => void): void {
	try {
		onDestroy(unsubscribe);
		if (mounted) onMount(mounted);
	} catch {}
}
