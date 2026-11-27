import { DEFAULT_BROWSER_PROFILE } from '$contract/browser';

class BrowserProfilesAggregate {
	names: readonly string[] = $state.raw([DEFAULT_BROWSER_PROFILE]);
	loaded = false;

	add(names: readonly string[]): void {
		const next = [...new Set([...this.names, ...names])].sort((left, right) =>
			left === DEFAULT_BROWSER_PROFILE
				? -1
				: right === DEFAULT_BROWSER_PROFILE
					? 1
					: left.localeCompare(right),
		);
		if (next.length !== this.names.length) this.names = next;
	}
}

export const browserProfilesAggregate = new BrowserProfilesAggregate();
