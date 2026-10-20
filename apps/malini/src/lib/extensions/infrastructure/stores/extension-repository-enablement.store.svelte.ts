import {
	PENDING_EXTENSION_REPOSITORY_ENABLEMENT,
	extensionRepositoryEnablementKey,
	type ExtensionRepositoryEnablement,
} from '../../domain/extension-repository-enablement';

class ExtensionRepositoryEnablementStore {
	entries = $state.raw<Readonly<Record<string, ExtensionRepositoryEnablement>>>({});
	readonly #generations = new Map<string, number>();

	get(workstreamId: string, extensionId: string): ExtensionRepositoryEnablement {
		const key = extensionRepositoryEnablementKey(workstreamId, extensionId);
		return this.entries[key] ?? PENDING_EXTENSION_REPOSITORY_ENABLEMENT;
	}

	update(
		workstreamId: string,
		extensionId: string,
		patch: Partial<ExtensionRepositoryEnablement>,
	): void {
		const key = extensionRepositoryEnablementKey(workstreamId, extensionId);
		this.entries = { ...this.entries, [key]: { ...this.get(workstreamId, extensionId), ...patch } };
	}

	beginLoad(workstreamId: string, extensionId: string): number {
		const key = extensionRepositoryEnablementKey(workstreamId, extensionId);
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		return generation;
	}

	isCurrentLoad(workstreamId: string, extensionId: string, generation: number): boolean {
		const key = extensionRepositoryEnablementKey(workstreamId, extensionId);
		return this.#generations.get(key) === generation;
	}
}

export const extensionRepositoryEnablementStore = new ExtensionRepositoryEnablementStore();
