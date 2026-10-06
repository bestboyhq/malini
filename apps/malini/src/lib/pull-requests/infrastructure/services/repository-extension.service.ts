import {
	REPOSITORY_STATE_CHANGED_EVENT,
	type RepositoryPullRequestFixContext,
	type RepositorySurfaceState,
	type RepositoryViewState,
} from '@malini-extension/repository';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import type { PullRequestFixPreparation } from '$lib/pull-requests/domain/pull-request-fix-prompt';
import type {
	RepositoryCommandOutcome,
	RepositorySurface,
} from '$lib/pull-requests/domain/repository-surface';
import { PullRequestFixDiagnosticsMapper } from '$lib/pull-requests/infrastructure/mappers/pull-request-fix-diagnostics.mapper';
import { RepositorySurfaceMapper } from '$lib/pull-requests/infrastructure/mappers/repository-surface.mapper';

class RepositoryExtensionService {
	isReadyFor(workstreamId: string): boolean {
		return extensionCommands.isReadyFor(workstreamId);
	}

	async execute(
		workstreamId: string,
		commandId: string,
		input?: unknown,
	): Promise<RepositoryCommandOutcome> {
		const state =
			input === undefined
				? await extensionCommands.execute<RepositoryViewState>(workstreamId, commandId)
				: await extensionCommands.execute<RepositoryViewState>(workstreamId, commandId, input);
		return RepositorySurfaceMapper.outcomeFromRaw(state);
	}

	async prepareFix(
		workstreamId: string,
		commandId: string,
	): Promise<PullRequestFixPreparation | null> {
		const context = await extensionCommands.execute<RepositoryPullRequestFixContext | null>(
			workstreamId,
			commandId,
		);
		if (context === null) return null;
		const state: RepositoryViewState | undefined = context.state;
		return {
			outcome: state === undefined ? null : RepositorySurfaceMapper.outcomeFromRaw(state),
			diagnostics: PullRequestFixDiagnosticsMapper.fromRaw(context),
		};
	}

	onSurfaceChanged(listener: (surface: RepositorySurface) => void): () => void {
		return extensionCommands.onEvent<RepositorySurfaceState>(
			REPOSITORY_STATE_CHANGED_EVENT,
			(raw) => listener(RepositorySurfaceMapper.fromRaw(raw)),
		);
	}
}

export const repositoryExtensionService = new RepositoryExtensionService();
