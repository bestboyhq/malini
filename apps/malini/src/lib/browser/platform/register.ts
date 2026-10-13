import type { BrowserWindow } from 'electron';
import {
	BROWSER_STATE_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import type { BrowserPlatform } from '../browser.platform';
import { readBounds, readUrl, readWorkstreamId } from './args';
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
	});

	commands.define('browser.show', (args) => views.show(readWorkstreamId(args), readBounds(args)));
	commands.define('browser.hide', (args) => views.hide(readWorkstreamId(args)));
	commands.define('browser.navigate', (args) =>
		views.navigate(readWorkstreamId(args), readUrl(args)),
	);
	commands.define('browser.go-back', (args) => views.goBack(readWorkstreamId(args)));
	commands.define('browser.go-forward', (args) => views.goForward(readWorkstreamId(args)));
	commands.define('browser.reload', (args) => views.reload(readWorkstreamId(args)));
	commands.define('browser.state', (args) => views.state(readWorkstreamId(args)));
	commands.define('browser.snapshot', (args) => views.snapshot(readWorkstreamId(args)));
	commands.define('browser.pick-element', (args) => views.pick(readWorkstreamId(args)));
	commands.define('browser.cancel-pick', (args) => views.cancelPick(readWorkstreamId(args)));

	events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, ({ workstreamId }) =>
		views.destroy(workstreamId),
	);

	return views;
}
