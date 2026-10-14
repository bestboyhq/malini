import type { BrowserWindow } from 'electron';
import {
	BROWSER_STATE_CHANGED_CHANNEL,
	BROWSER_TAB_OPENED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import type { BrowserPlatform } from '../browser.platform';
import { readBounds, readTab, readUrl } from './args';
import { createElectronView, watchRendererReset } from './electron-view';
import { BrowserViews } from './views';

export interface BrowserDeps {
	getMainWindow(): BrowserWindow | null;
}

export function registerBrowser(context: MainContext, deps: BrowserDeps): BrowserPlatform {
	const { commands, events, db } = context;
	const views = new BrowserViews<BrowserWindow>({
		getMainWindow: deps.getMainWindow,
		createView: createElectronView,
		watchRendererReset,
		workstreamExists: (workstreamId) => getWorkstream(db, workstreamId) !== null,
		stateChanged: (state) => events.emit(BROWSER_STATE_CHANGED_CHANNEL, state),
		tabOpened: (tab) => events.emit(BROWSER_TAB_OPENED_CHANNEL, tab),
	});

	commands.define('browser.show', (args) => views.show(readTab(args), readBounds(args)));
	commands.define('browser.hide', (args) => views.hide(readTab(args)));
	commands.define('browser.navigate', (args) => views.navigate(readTab(args), readUrl(args)));
	commands.define('browser.go-back', async (args) => {
		await views.goBack(readTab(args));
	});
	commands.define('browser.go-forward', async (args) => {
		await views.goForward(readTab(args));
	});
	commands.define('browser.reload', async (args) => {
		await views.reload(readTab(args));
	});
	commands.define('browser.state', (args) => views.state(readTab(args)));
	commands.define('browser.snapshot', (args) => views.snapshot(readTab(args)));
	commands.define('browser.pick-element', (args) => views.pick(readTab(args)));
	commands.define('browser.cancel-pick', (args) => views.cancelPick(readTab(args)));
	commands.define('browser.close', (args) => views.destroy(readTab(args)));

	events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, ({ workstreamId }) =>
		views.destroyWorkstream(workstreamId),
	);

	return views;
}
