import type { BestboyAccess } from '$lib/stats/stats.platform';
import type {
	CheckoutResolver,
	RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';

import type { ExtensionPackages, ExtensionPackagePaths } from './platform/packages';

export type { ExtensionPackagePaths } from './platform/packages';
export { openFileForUser, type OpenedFile } from './platform/opened-files';

export type ExtensionsPlatformDeps = Readonly<{
	resolver: CheckoutResolver;
	readCheckout: RepositoriesPlatform['readCheckout'];
	bestboy: () => BestboyAccess;
	packages?: Partial<ExtensionPackagePaths>;
}>;

export type ExtensionsPlatform = Readonly<{
	packages: ExtensionPackages;
	pluginFolders(): string[];
	start(): void;
	stop(): void;
}>;
