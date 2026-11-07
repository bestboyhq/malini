import { demoBridge } from './demo-bridge';
import { DOCS_DRAFTS, DOCS_WORKSTREAMS } from './demo-docs';
import { demoHandlers } from './demo-handlers';
import { passScrollToTheSite } from './demo-scroll';
import { DEMO_PLAY } from './demo-play';
import { reportRows } from './demo-setup';
import { playTour } from './demo-tour';

const SITE_THEME = 'theme';

function siteTheme(): 'light' | 'dark' | 'system' {
	const theme = localStorage.getItem(SITE_THEME);
	return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function freshScenes(): void {
	const scenes = DOCS_WORKSTREAMS.map((workstream) => workstream.id);
	for (const stored of Object.keys(localStorage)) {
		if (stored.startsWith('malini.') && scenes.some((scene) => stored.includes(scene))) {
			localStorage.removeItem(stored);
		}
	}
	for (const [workstreamId, draft] of DOCS_DRAFTS) {
		localStorage.setItem(`malini.chat.draft:${workstreamId}|session-${workstreamId}`, draft);
	}
	localStorage.setItem('malini.settings.theme', siteTheme());
}

if (DEMO_PLAY === 'docs') {
	document.documentElement.dataset['demo'] = 'docs';
	freshScenes();
}

window.malini = demoBridge(demoHandlers);
passScrollToTheSite();

await import('../src/main');

if (DEMO_PLAY === 'tour') void playTour();
if (DEMO_PLAY === 'setup') reportRows();
if (DEMO_PLAY === 'docs') {
	const { chooseThemeModeCommand } =
		await import('$lib/app/application/commands/choose-theme-mode.command');
	addEventListener('storage', (event) => {
		if (event.key === SITE_THEME) chooseThemeModeCommand(siteTheme());
	});
}
