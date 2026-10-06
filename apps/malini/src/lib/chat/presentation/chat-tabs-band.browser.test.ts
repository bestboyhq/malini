import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { globalTopBarBandSlot } from '$shared/shell/global-topbar-actions.svelte';
import ChatTabs from './ChatTabs.svelte';

const WORKSTREAM = 'ws-band';
const HOME_WIDTH = 300;
const BAND_WIDTH = 1_000;
const TAB_WIDTH = 224;

let stop: (() => void) | null = null;

afterEach(() => {
	stop?.();
	stop = null;
	globalTopBarBandSlot.host = null;
	sessionsAggregate.reset();
	vi.restoreAllMocks();
});

function chat(sessionId: string, startedAt: string): void {
	sessionsAggregate.hydrateSession({
		sessionId,
		workstreamId: WORKSTREAM,
		displayName: sessionId,
		model: null,
		status: 'idle',
		startedAt,
	});
}

function layOutHomeNarrowerThanTheBand(band: HTMLElement): void {
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
		this: Element,
	): DOMRect {
		if (this.hasAttribute('data-overflow-measure-item')) return new DOMRect(0, 0, TAB_WIDTH, 32);
		if (this.hasAttribute('data-overflow-measure-reserved')) return new DOMRect(0, 0, 26, 32);
		if (this.hasAttribute('data-overflow-measure-trigger')) return new DOMRect(0, 0, 30, 32);
		if (this.getAttribute('role') === 'tablist') {
			return new DOMRect(0, 0, band.contains(this) ? BAND_WIDTH : HOME_WIDTH, 32);
		}
		return new DOMRect(0, 0, 0, 0);
	});
}

function renderTabsHostedIn(band: HTMLElement): HTMLElement {
	const home = document.createElement('div');
	document.body.append(home, band);
	const app = mount(ChatTabs, {
		target: home,
		props: {
			workstreamId: WORKSTREAM,
			activeSessionId: 's-newer',
			fresh: false,
			planMode: false,
			onnewchat: () => undefined,
			onclosefresh: () => undefined,
		},
	});
	stop = () => {
		void unmount(app);
		home.remove();
		band.remove();
	};
	return home;
}

function chatTabsIn(element: HTMLElement): readonly string[] {
	return [...element.querySelectorAll<HTMLElement>('[role="tab"][data-session-id]')].map(
		(tab) => tab.dataset['sessionId'] ?? '',
	);
}

describe('the chat tabs hosted in the top bar band', () => {
	it('shows every chat that fits the band in the first frame', () => {
		chat('s-older', '2026-01-01T00:00:00.000Z');
		chat('s-newer', '2026-01-02T00:00:00.000Z');
		const band = document.createElement('div');
		layOutHomeNarrowerThanTheBand(band);
		globalTopBarBandSlot.host = band;

		renderTabsHostedIn(band);
		flushSync();

		expect(chatTabsIn(band)).toEqual(['s-newer', 's-older']);
	});
});
