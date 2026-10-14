import type { BrowserState, BrowserTabArgs } from '$contract/browser';
import { BROWSER_STATE_CHANGED_CHANNEL } from '$contract/events';
import type { FakeBridge } from './fake-bridge';

type FakePage = { history: string[]; index: number };

export function installBrowserFake(bridge: FakeBridge): void {
	const pages = new Map<string, FakePage>();

	bridge.onReset(() => pages.clear());

	const keyOf = ({ workstreamId, tabId }: BrowserTabArgs): string => `${workstreamId}/${tabId}`;

	const pageFor = (tab: BrowserTabArgs): FakePage => {
		const existing = pages.get(keyOf(tab));
		if (existing) return existing;
		const created: FakePage = { history: [], index: -1 };
		pages.set(keyOf(tab), created);
		return created;
	};

	const stateOf = ({ workstreamId, tabId }: BrowserTabArgs): BrowserState => {
		const page = pageFor({ workstreamId, tabId });
		const url = page.history[page.index] ?? '';
		return {
			workstreamId,
			tabId,
			url,
			title: url,
			favicon: null,
			loading: false,
			canGoBack: page.index > 0,
			canGoForward: page.index < page.history.length - 1,
		};
	};

	const changed = (tab: BrowserTabArgs): void => {
		bridge.emit(BROWSER_STATE_CHANGED_CHANNEL, stateOf(tab));
	};

	bridge.define('browser.show', async () => {});
	bridge.define('browser.hide', async () => {});
	bridge.define('browser.state', async (tab) => stateOf(tab));
	bridge.define('browser.snapshot', async () => null);
	bridge.define('browser.pick-element', async () => null);
	bridge.define('browser.cancel-pick', async () => {});
	bridge.define('browser.close', async (tab) => {
		pages.delete(keyOf(tab));
	});

	bridge.define('browser.navigate', async (args) => {
		const page = pageFor(args);
		page.history = [...page.history.slice(0, page.index + 1), args.url];
		page.index = page.history.length - 1;
		changed(args);
	});

	bridge.define('browser.go-back', async (tab) => {
		const page = pageFor(tab);
		if (page.index > 0) page.index -= 1;
		changed(tab);
	});

	bridge.define('browser.go-forward', async (tab) => {
		const page = pageFor(tab);
		if (page.index < page.history.length - 1) page.index += 1;
		changed(tab);
	});

	bridge.define('browser.reload', async (tab) => changed(tab));
}
