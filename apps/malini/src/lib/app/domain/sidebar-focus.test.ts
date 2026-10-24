import { describe, expect, it } from 'vitest';
import {
	ALL_FOCUS,
	DEFAULT_SIDEBAR_FOCUS,
	chooseFocus,
	focusStillExists,
	readSidebarFocus,
	togglePinned,
	type SidebarFocus,
} from './sidebar-focus';

const acme: SidebarFocus = { kind: 'owner', owner: 'acme' };
const site: SidebarFocus = { kind: 'repository', repositoryId: 'repo-1' };

describe('sidebar focus', () => {
	it('pins and unpins a focus, and leaving the active one goes back to All', () => {
		const pinned = togglePinned(togglePinned(DEFAULT_SIDEBAR_FOCUS, acme), site);
		const focused = chooseFocus(pinned, { kind: 'owner', owner: 'ACME' });
		expect(focused.pinned).toEqual([acme, site]);
		expect(togglePinned(focused, acme)).toEqual({ pinned: [site], active: ALL_FOCUS });
		expect(togglePinned(focused, ALL_FOCUS)).toBe(focused);
	});

	it('reads what it stored and drops anything it cannot read', () => {
		expect(
			readSidebarFocus({
				pinned: [
					acme,
					{ kind: 'owner', owner: 'Acme' },
					{ kind: 'all' },
					{ kind: 'repository' },
					site,
				],
				active: site,
			}),
		).toEqual({ pinned: [acme, site], active: site });
		expect(readSidebarFocus('nope')).toEqual(DEFAULT_SIDEBAR_FOCUS);
	});

	it('knows when an owner or repository it focuses on is gone', () => {
		const present = { owners: new Set(['acme']), repositoryIds: new Set(['repo-2']) };
		expect([ALL_FOCUS, acme, site].map((focus) => focusStillExists(focus, present))).toEqual([
			true,
			true,
			false,
		]);
	});
});
