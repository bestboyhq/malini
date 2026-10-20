import type { CheckoutResolver } from '$shared/repositories/repositories.platform';

import type { ExtensionPackages, ExtensionPackagePaths } from './platform/packages';

export type { ExtensionPackagePaths } from './platform/packages';
export { NO_MARKETPLACE_ERROR } from './platform/packages';

export type ExtensionsPlatformDeps = Readonly<{
	resolver: CheckoutResolver;
	packages?: Partial<ExtensionPackagePaths>;
}>;

export type ExtensionsPlatform = Readonly<{
	packages: ExtensionPackages;
}>;
