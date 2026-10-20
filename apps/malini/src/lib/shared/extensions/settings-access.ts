import type {
	ExtensionManifest,
	ExtensionSettingManifest,
	ExtensionSettingScope,
	ExtensionSettingValue,
} from '@malini/extension-api';
import { resolveRepositorySettingScopeId } from './repository-setting-scope';

export type ExtensionSettingsAccessPort = Readonly<{
	definitions(manifest: ExtensionManifest): readonly ExtensionSettingManifest[];
	get(
		extensionId: string,
		definition: ExtensionSettingManifest,
		scope: ExtensionSettingScope,
	): ExtensionSettingValue;
	set(
		extensionId: string,
		definition: ExtensionSettingManifest,
		value: ExtensionSettingValue,
		scope: ExtensionSettingScope,
	): Promise<void>;
}>;

export type ExtensionSettingsRegistration = Readonly<{
	access: ExtensionSettingsAccessPort;
	dispose(): Promise<void>;
}>;

export function resolveDirectorySettingScope(
	definition: ExtensionSettingManifest,
	context: {
		workstreamId?: string | undefined;
		repositoryPath?: string | undefined;
		repositoryFullName?: string | undefined;
	},
): ExtensionSettingScope | null {
	if (!definition.scope || definition.scope === 'global') return { kind: 'global' };
	if (definition.scope === 'workstream') {
		return context.workstreamId ? { kind: 'workstream', id: context.workstreamId } : null;
	}
	const repositoryId = resolveRepositorySettingScopeId(context);
	return repositoryId ? { kind: 'repository', id: repositoryId } : null;
}
