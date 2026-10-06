export type BundledExtensionActivation = 'built-in' | 'workstream';

const ACTIVATION_BY_EXTENSION_ID: ReadonlyMap<string, BundledExtensionActivation> = new Map([
	['malini.repository', 'built-in'],
]);

export function bundledExtensionActivation(extensionId: string): BundledExtensionActivation | null {
	return ACTIVATION_BY_EXTENSION_ID.get(extensionId) ?? null;
}
