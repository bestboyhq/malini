import type { BrowserState } from '$contract/browser';
import { BROWSER_STATE_CHANGED_CHANNEL } from '$contract/events';
import type { FakeBridge } from './fake-bridge';

type FakePage = { history: string[]; index: number };

export function installBrowserFake(bridge: FakeBridge): void {
	const pages = new Map<string, FakePage>();

	bridge.onReset(() => pages.clear());

	const pageFor = (workstreamId: string): FakePage => {
		const existing = pages.get(workstreamId);
		if (existing) return existing;
		const created: FakePage = { history: [], index: -1 };
		pages.set(workstreamId, created);
		return created;
	};

	const stateOf = (workstreamId: string): BrowserState => {
		const page = pageFor(workstreamId);
		const url = page.history[page.index] ?? '';
		return {
			workstreamId,
			url,
			title: url,
			loading: false,
			canGoBack: page.index > 0,
			canGoForward: page.index < page.history.length - 1,
		};
	};

	const changed = (workstreamId: string): void => {
		bridge.emit(BROWSER_STATE_CHANGED_CHANNEL, stateOf(workstreamId));
	};

	bridge.define('browser.show', async () => {});
	bridge.define('browser.hide', async () => {});
	bridge.define('browser.state', async ({ workstreamId }) => stateOf(workstreamId));
	bridge.define('browser.snapshot', async () => null);
	bridge.define('browser.pick-element', async () => null);
	bridge.define('browser.cancel-pick', async () => {});
	bridge.define('browser.close', async ({ workstreamId }) => {
		pages.delete(workstreamId);
	});

	bridge.define('browser.navigate', async ({ workstreamId, url }) => {
		const page = pageFor(workstreamId);
		page.history = [...page.history.slice(0, page.index + 1), url];
		page.index = page.history.length - 1;
		changed(workstreamId);
	});

	bridge.define('browser.go-back', async ({ workstreamId }) => {
		const page = pageFor(workstreamId);
		if (page.index > 0) page.index -= 1;
		changed(workstreamId);
	});

	bridge.define('browser.go-forward', async ({ workstreamId }) => {
		const page = pageFor(workstreamId);
		if (page.index < page.history.length - 1) page.index += 1;
		changed(workstreamId);
	});

	bridge.define('browser.reload', async ({ workstreamId }) => changed(workstreamId));
}
