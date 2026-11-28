import { DEFAULT_BROWSER_PROFILE, type BrowserTabArgs } from '$contract/browser';
import type { BrowserTab } from '../../domain/browser-tab';

class BrowserTabsAggregate {
	byWorkstream: Readonly<Record<string, readonly BrowserTab[]>> = $state.raw({});

	has(workstreamId: string): boolean {
		return workstreamId in this.byWorkstream;
	}

	tabsOf(workstreamId: string): readonly BrowserTab[] {
		return this.byWorkstream[workstreamId] ?? [];
	}

	profileOf(tab: BrowserTabArgs): string {
		return (
			this.tabsOf(tab.workstreamId).find(({ tabId }) => tabId === tab.tabId)?.profile ??
			DEFAULT_BROWSER_PROFILE
		);
	}

	set(workstreamId: string, tabs: readonly BrowserTab[]): void {
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: tabs };
	}
}

export const browserTabsAggregate = new BrowserTabsAggregate();
