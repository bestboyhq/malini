import type {
	CheckoutResolver,
	RepositoriesPlatform,
} from '$shared/repositories/repositories.platform';

import type { ExtensionPackages, ExtensionPackagePaths } from './platform/packages';

export type { ExtensionPackagePaths } from './platform/packages';
export { NO_MARKETPLACE_ERROR } from './platform/packages';
export { openFileForUser, type OpenedFile } from './platform/opened-files';

export type ExtensionsPlatformDeps = Readonly<{
	resolver: CheckoutResolver;
	readCheckout: RepositoriesPlatform['readCheckout'];
	packages?: Partial<ExtensionPackagePaths>;
}>;

export type ExtensionsPlatform = Readonly<{
	packages: ExtensionPackages;
}>;
