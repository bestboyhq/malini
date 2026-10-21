import type { RepositoryImportSource } from '$shared/repositories/domain/github-auth';
import { projectIdentityCandidatesForRepoUrl } from '$shared/repositories/domain/project-identity';
import type { Repository } from '$shared/repositories/domain/repository';
import {
	repositoryConnectFailure,
	repositoryConnectionFor,
} from '$shared/repositories/domain/repository-connection';
import { repositoryCloneSource } from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { goto } from '$shared/router/navigation';
import { repositoryHref } from '$shared/router/routes-hrefs';
import { syncOwnPullRequestsCommand } from './sync-own-pull-requests.command';

export { connectRepositoryCommand };

function connectRepositoryCommand(source: RepositoryImportSource, onConnected?: () => void): void {
	if (repositoryConnectionStore.connecting !== null) return;
	repositoryConnectionStore.connecting = repositoryConnectionFor(source);
	repositoryConnectionStore.error = null;
	void (async () => {
		try {
			const repo = await connectAndRecordProject(source);
			await goto(repositoryHref(repo.id));
			onConnected?.();
			syncOwnPullRequestsCommand();
		} catch (caught) {
			const failure = repositoryConnectFailure(caught, 'Failed to connect repository', source);
			repositoryConnectionStore.error = failure;
		} finally {
			repositoryConnectionStore.connecting = null;
		}
	})();
}

async function connectAndRecordProject(source: RepositoryImportSource): Promise<Repository> {
	const { repo, created } = await repositoriesAggregate.connect(source);
	try {
		await recordProject(repositoryCloneSource(repo), repo.defaultBranch || 'main');
	} catch (connectionError) {
		if (created) await rollbackConnectedRepository(repo.id);
		throw connectionError;
	}
	repositoriesAggregate.reveal(repo.id);
	await Promise.all([repositoriesAggregate.refresh(), workstreamsAggregate.refresh()]);
	return repo;
}

async function recordProject(repoUrl: string, defaultBranch: string): Promise<void> {
	const projects = await workstreamsService.listProjects();
	const candidateIds = new Set(
		projectIdentityCandidatesForRepoUrl(repoUrl).map((identity) => identity.id),
	);
	const recorded = projects.some(
		(project) => candidateIds.has(project.id) && project.repoPath.trim().length > 0,
	);
	if (!recorded) await workstreamsService.createProject({ repoUrl, defaultBranch });
}

async function rollbackConnectedRepository(repoId: string): Promise<void> {
	try {
		await repositoriesAggregate.disconnect(repoId);
	} catch {}
}
