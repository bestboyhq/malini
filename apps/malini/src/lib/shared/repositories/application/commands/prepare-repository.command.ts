import { projectIdentityCandidatesForRepoUrl } from '$shared/repositories/domain/project-identity';
import type { Repository } from '$shared/repositories/domain/repository';
import {
	repositoryConnectFailure,
	type RepositoryConnectFailure,
} from '$shared/repositories/domain/repository-connection';
import { repositoryCloneSource } from '$shared/repositories/domain/repository-context';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { syncOwnPullRequestsCommand } from './sync-own-pull-requests.command';

export { prepareRepositoryCommand };

function prepareRepositoryCommand(repo: Repository): void {
	if (!repositoryConnectionStore.startPreparing(repo.id)) return;
	void (async () => {
		let failure: RepositoryConnectFailure | null = null;
		try {
			await recordProject(repositoryCloneSource(repo), repo.defaultBranch || 'main');
			await Promise.all([repositoriesAggregate.refresh(), workstreamsAggregate.refresh()]);
			syncOwnPullRequestsCommand();
		} catch (caught) {
			failure = repositoryConnectFailure(caught, 'Failed to clone repository', repo.fullName);
		} finally {
			repositoryConnectionStore.finishPreparing(repo.id, failure);
		}
	})();
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
