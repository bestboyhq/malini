import { app, type BrowserWindow } from 'electron';
import {
	BROWSER_RESIZE_REQUESTED_CHANNEL,
	BROWSER_STATE_CHANGED_CHANNEL,
	BROWSER_TAB_OPENED_CHANNEL,
	BROWSER_THREAD_OPENED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { resolveWorkstreamCheckoutCanonical } from '$main/git/paths';
import { listElementThreads, threadWorkstreamId } from '$lib/chat/chat.platform';
import { getWorkstream, listWorkstreams } from '$shared/repositories/repositories.platform';
import type { BrowserPlatform } from '../browser.platform';
import { readBounds, readPick, readRequestId, readTab, readUrl } from './args';
import { askBeforeMediaAccess, createElectronView, watchRendererReset } from './electron-view';
import { movesPin, startElementThread, threadPin } from './threads';
import { BrowserViews } from './views';
import { serveWorktreeFiles } from './worktree-files';

export interface BrowserDeps {
	getMainWindow(): BrowserWindow | null;
}

export function registerBrowser(context: MainContext, deps: BrowserDeps): BrowserPlatform {
	const { commands, events, db, appDataRoot } = context;
	const worktree = (workstreamId: string): string =>
		resolveWorkstreamCheckoutCanonical(appDataRoot, workstreamId);
	serveWorktreeFiles((host) => {
		const workstream = listWorkstreams(db).find(({ id }) => id.toLowerCase() === host);
		try {
			return workstream ? worktree(workstream.id) : null;
		} catch {
			return null;
		}
	});
	askBeforeMediaAccess(deps.getMainWindow);
	const views = new BrowserViews<BrowserWindow>({
		getMainWindow: deps.getMainWindow,
		onScreen: (window) => !app.isHidden() && !window.isMinimized(),
		createView: createElectronView,
		watchRendererReset,
		workstreamExists: (workstreamId) => getWorkstream(db, workstreamId) !== null,
		worktree,
		stateChanged: (state) => events.emit(BROWSER_STATE_CHANGED_CHANNEL, state),
		tabOpened: (tab) => events.emit(BROWSER_TAB_OPENED_CHANNEL, tab),
		resizeRequested: (request) => events.emit(BROWSER_RESIZE_REQUESTED_CHANNEL, request),
		threads: (workstreamId) => listElementThreads(db, workstreamId).map(threadPin),
		startThread: (tab, picked, profile) => startElementThread(commands, tab, picked, profile),
		threadAction: async (tab, { kind, sessionId }) => {
			if (threadWorkstreamId(db, sessionId) !== tab.workstreamId) return;
			if (kind === 'open') {
				events.emit(BROWSER_THREAD_OPENED_CHANNEL, { workstreamId: tab.workstreamId, sessionId });
				return;
			}
			try {
				await commands.call('chat.archive-session', { sessionId });
			} finally {
				views.showThreads(tab.workstreamId);
			}
		},
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
	commands.define('browser.pick-element', (args) => views.pick(readPick(args)));
	commands.define('browser.cancel-pick', (args) => views.cancelPick(readTab(args)));
	commands.define('browser.close', (args) => views.destroy(readTab(args)));
	commands.define('browser.resized', (args) => views.resized(readRequestId(args)));

	events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, ({ workstreamId }) =>
		views.destroyWorkstream(workstreamId),
	);
	events.subscribe(CHAT_AGENT_EVENT_CHANNEL, ({ sessionId, event, ephemeral }) => {
		if (ephemeral || !movesPin(event['type'])) return;
		const workstreamId = threadWorkstreamId(db, sessionId);
		if (workstreamId) views.showThreads(workstreamId);
	});

	return views;
}
