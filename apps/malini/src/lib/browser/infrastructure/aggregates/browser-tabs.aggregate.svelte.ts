class BrowserTabsAggregate {
	byWorkstream: Readonly<Record<string, readonly string[]>> = $state.raw({});

	has(workstreamId: string): boolean {
		return workstreamId in this.byWorkstream;
	}

	tabsOf(workstreamId: string): readonly string[] {
		return this.byWorkstream[workstreamId] ?? [];
	}

	set(workstreamId: string, tabIds: readonly string[]): void {
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: tabIds };
	}
}

export const browserTabsAggregate = new BrowserTabsAggregate();
