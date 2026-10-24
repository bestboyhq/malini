import { REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError } from '$main/errors';
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
	baseRef: string | null = null,
	startedBy: string | null = null,
): Promise<void> {
	await commands.call('repositories.create-workstream', {
		projectRepoPath,
		workstreamId: plan.workstreamId,
		baseBranch: plan.baseBranch,
		projectId: plan.projectId,
		name: plan.name,
		baseRef,
		startedBy,
	});
}

export async function prepareStartedWorkstream(
	{ commands, events }: Pick<MainContext, 'commands' | 'events'>,
	workstreamId: string,
	log: (line: string) => void,
): Promise<void> {
	const steps = [
		['update the base branch of', 'repositories.sync-workstream-base'],
		['install dependencies in', 'repositories.provision-dependencies'],
	] as const;
	events.emit(REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL, { workstreamId, status: 'running' });
	try {
		for (const [what, command] of steps) {
			try {
				await commands.call(command, { workstreamId });
			} catch (error) {
				log(`could not ${what} \`${workstreamId}\`: ${describeError(error)}`);
			}
		}
	} finally {
		events.emit(REPOSITORIES_WORKSTREAM_SETUP_STATUS_CHANNEL, { workstreamId, status: 'done' });
	}
}
