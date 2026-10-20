import type { RepositoryImportSource } from '$shared/repositories/domain/github-auth';
import {
	projectIdentityCandidatesForRepoUrl,
	projectIdentityForRepoUrl,
	nextWorkstreamId,
} from '$shared/repositories/domain/project-identity';
import type { Project } from '$shared/repositories/domain/repository';
import {
	repositoryConnectFailure,
	repositoryConnectionFor,
} from '$shared/repositories/domain/repository-connection';
import { repositoryCloneSource } from '$shared/repositories/domain/repository-context';
import { workstreamFromCreated, type Workstream } from '$shared/repositories/domain/workstream';
import {
	takenWorkstreamNames,
	uniqueWorkstreamName,
} from '$shared/repositories/domain/workstream-names';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { repositoryConnectionStore } from '$shared/repositories/infrastructure/stores/repository-connection.store.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { connectRepositoryCommand };

function connectRepositoryCommand(source: RepositoryImportSource, onConnected?: () => void): void {
	if (repositoryConnectionStore.connecting !== null) return;
	repositoryConnectionStore.connecting = repositoryConnectionFor(source);
	repositoryConnectionStore.error = null;
	void (async () => {
		try {
			const workstream = await connectAndOpenWorkstream(source);
			seedWorkstreamDependenciesCommand(workstream.id);
			void repositoriesAggregate.refresh();
			await goto(workstreamHref(workstream.id));
			onConnected?.();
		} catch (caught) {
			const failure = repositoryConnectFailure(caught, 'Failed to connect repository', source);
			repositoryConnectionStore.error = failure;
		} finally {
			repositoryConnectionStore.connecting = null;
		}
	})();
}

async function connectAndOpenWorkstream(source: RepositoryImportSource): Promise<Workstream> {
	const { repo, created } = await repositoriesAggregate.connect(source);
	const repoUrl = repositoryCloneSource(repo);
	const workstreamId = nextWorkstreamId();
	const baseBranch = repo.defaultBranch || 'main';
	let workstream: Workstream;
	try {
		const project = await existingOrClonedProject(repoUrl, baseBranch);
		workstream = workstreamFromCreated(
			await workstreamsService.createWorkstream({
				projectId: project.id,
				projectRepoPath: project.repoPath,
				workstreamId,
				name: uniqueWorkstreamName(
					workstreamId,
					takenWorkstreamNames(workstreamsAggregate.workstreams),
				),
				baseBranch,
			}),
		);
	} catch (connectionError) {
		if (created) await rollbackConnectedRepository(repo.id);
		throw connectionError;
	}
	workstreamsAggregate.upsert(workstream);
	repositoriesAggregate.reveal(repo.id);
	await Promise.all([repositoriesAggregate.refresh(), workstreamsAggregate.refresh()]);
	return workstream;
}

async function existingOrClonedProject(repoUrl: string, baseBranch: string): Promise<Project> {
	const projects = await workstreamsService.listProjects();
	const candidateIds = new Set(
		projectIdentityCandidatesForRepoUrl(repoUrl).map((identity) => identity.id),
	);
	const existing = projects.find(
		(project) => candidateIds.has(project.id) && project.repoPath.trim().length > 0,
	);
	if (existing) return existing;
	const identity = projectIdentityForRepoUrl(repoUrl);
	const repoPath = await workstreamsService.createProject({ repoUrl });
	return { id: identity.id, name: identity.name, repoPath, defaultBranch: baseBranch };
}

async function rollbackConnectedRepository(repoId: string): Promise<void> {
	try {
		await repositoriesAggregate.disconnect(repoId);
	} catch {}
}
