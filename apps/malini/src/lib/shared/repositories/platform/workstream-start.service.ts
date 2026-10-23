import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import {
	planWorkstreamProvisioning,
	type WorkstreamProvisioningPlan,
} from '../domain/provisioning';
import { listProjects } from './projects.repository';
import { resolveConnectedRepository } from './repository.service';
import { listWorkstreams } from './workstreams.repository';

type Commands = MainContext['commands'];

export async function planRepositoryWorkstream(
	db: MaliniDatabase,
	repositoryId: string,
): Promise<WorkstreamProvisioningPlan | null> {
	const repository = await resolveConnectedRepository(db, repositoryId);
	if (!repository) return null;
	return planWorkstreamProvisioning({
		repo: repository,
		projects: listProjects(db),
		takenNames: listWorkstreams(db).map((workstream) => workstream.name),
	});
}

export async function clonePlannedRepository(
	commands: Commands,
	plan: WorkstreamProvisioningPlan,
): Promise<string> {
	return (
		plan.projectRepoPath ??
		(await commands.call('repositories.create-repository', {
			repoUrl: plan.repoUrl,
			defaultBranch: plan.baseBranch,
		}))
	);
}

export async function createPlannedWorkstream(
	commands: Commands,
	plan: WorkstreamProvisioningPlan,
	projectRepoPath: string,
): Promise<void> {
	await commands.call('repositories.create-workstream', {
		projectRepoPath,
		workstreamId: plan.workstreamId,
		baseBranch: plan.baseBranch,
		projectId: plan.projectId,
		name: plan.name,
	});
}
