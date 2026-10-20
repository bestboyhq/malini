import {
	REPOSITORY_STATE_CHANGED_EVENT,
	type RepositorySurfaceState,
	type RepositoryViewState,
} from '@malini-extension/repository';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import type {
	RepositoryCommandOutcome,
	RepositorySurface,
} from '$lib/pull-requests/domain/repository-surface';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';

class RepositoryExtensionService {
	isReadyFor(workstreamId: string): boolean {
		return extensionCommands.isReadyFor(workstreamId);
	}

	async execute(workstreamId: string, commandId: string): Promise<RepositoryCommandOutcome> {
		return RepositorySurfaceMapper.outcomeFromRaw(
			await extensionCommands.execute<RepositoryViewState>(workstreamId, commandId),
		);
	}

	onSurfaceChanged(listener: (surface: RepositorySurface) => void): () => void {
		return extensionCommands.onEvent<RepositorySurfaceState>(
			REPOSITORY_STATE_CHANGED_EVENT,
			(raw) => listener(RepositorySurfaceMapper.fromRaw(raw)),
		);
	}
}

export const repositoryExtensionService = new RepositoryExtensionService();
