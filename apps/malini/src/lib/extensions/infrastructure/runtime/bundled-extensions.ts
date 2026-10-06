import {
	assertExtensionManifest,
	type ExtensionManifest,
	type ExtensionModule,
} from '@malini/extension-api';
import repository from '@malini-extension/repository';
import repositoryManifest from '@malini-extension/repository/manifest.json';

import {
	bundledExtensionActivation,
	type BundledExtensionActivation,
} from '../../domain/bundled-extension-activation';

type BundledExtension = Readonly<{
	manifest: ExtensionManifest;
	module: ExtensionModule;
	trusted: true;
	activation: BundledExtensionActivation;
}>;

function bundled(
	manifest: unknown,
	module: ExtensionModule,
	activation: BundledExtension['activation'],
): BundledExtension {
	return { manifest: assertExtensionManifest(manifest), module, trusted: true, activation };
}

export const bundledExtensions: readonly BundledExtension[] = Object.freeze([
	bundled(
		repositoryManifest,
		repository,
		bundledExtensionActivation('malini.repository') ?? 'built-in',
	),
]);
