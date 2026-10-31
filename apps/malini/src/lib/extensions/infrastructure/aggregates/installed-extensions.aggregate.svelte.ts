import type { InstalledExtension } from '$contract/marketplace';

class InstalledExtensionsAggregate {
	installed = $state.raw<readonly InstalledExtension[] | null>(null);
	failure = $state.raw<string | null>(null);

	replace(installed: readonly InstalledExtension[]): void {
		this.installed = installed;
		this.failure = null;
	}

	fail(failure: string): void {
		this.failure = failure;
	}
}

export const installedExtensionsAggregate = new InstalledExtensionsAggregate();
