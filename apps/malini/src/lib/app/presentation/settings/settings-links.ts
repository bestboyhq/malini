import type { BeforeNavigate } from '$shared/router/hash-router.svelte';
import { goto, pushState, replaceState } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';

const SETTINGS_PATH = /^\/settings(?:\/|$)/u;

export function openSettingsOverPage(navigation: BeforeNavigate): void {
	const pathname = navigation.to?.url.pathname;
	if (pathname === undefined || !SETTINGS_PATH.test(pathname)) return;
	navigation.cancel();
	const settings = pathname.replace(/\/$/u, '');
	if (navigation.type === 'enter') {
		void openOverRepositories(settings);
		return;
	}
	const state = { ...page.state, settings };
	if (navigation.type === 'popstate' || page.state.settings !== undefined) replaceState('', state);
	else pushState('', state);
}

async function openOverRepositories(settings: string): Promise<void> {
	await goto(REPOSITORIES_HREF, { replaceState: true });
	pushState('', { settings });
}
