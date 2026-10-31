import type { InstallOutcomeResult } from '$contract/system';
import type { WorkstreamBaseSyncOutcome } from '$contract/repositories';
import { invoke } from '$shared/port/invoke';
import { leadScopeKey } from '$shared/repositories/domain/lead-scope';
import { workstreamBranch } from '$shared/repositories/domain/project-identity';
import type { LeadChatPlan } from '$shared/repositories/domain/provisioning';
import type { Project } from '$shared/repositories/domain/repository';
import type {
	ArchivedWorkstream,
	CreateWorkstreamInput,
	CreatedWorkstream,
	Workstream,
	WorkstreamId,
} from '$shared/repositories/domain/workstream';
import type { WorkstreamGitStatus } from '$shared/repositories/domain/workstream-git-status';
import {
	ArchivedWorkstreamMapper,
	WorkstreamMapper,
} from '$shared/repositories/infrastructure/mappers/workstream.mapper';
import { ProjectMapper } from '$shared/repositories/infrastructure/mappers/project.mapper';
import { markWorkstreamCreated } from './workstream-creation-marker.storage';

class WorkstreamsService {
	async listWorkstreams(): Promise<Workstream[]> {
		return WorkstreamMapper.fromRawList(await invoke('repositories.list-workstreams', undefined));
	}

	async listArchivedWorkstreams(): Promise<ArchivedWorkstream[]> {
		return ArchivedWorkstreamMapper.fromRawList(
			await invoke('repositories.list-archived-workstreams', undefined),
		);
	}

	async listProjects(): Promise<Project[]> {
		return ProjectMapper.fromRawList(await invoke('repositories.list-repositories', undefined));
	}

	createProject(input: { repoUrl: string; defaultBranch?: string }): Promise<string> {
		return invoke('repositories.create-repository', input);
	}

	async createWorkstream(input: CreateWorkstreamInput): Promise<CreatedWorkstream> {
		const worktreePath = await invoke('repositories.create-workstream', {
			projectRepoPath: input.projectRepoPath,
			workstreamId: input.workstreamId,
			baseBranch: input.baseBranch,
			projectId: input.projectId,
			name: input.name,
		});
		markWorkstreamCreated(input.workstreamId, undefined, input.creationContext);
		return {
			id: input.workstreamId,
			projectId: input.projectId,
			name: input.name,
			branch: workstreamBranch(input.workstreamId),
			baseBranch: input.baseBranch,
			createdAt: new Date().toISOString(),
			worktreePath,
		};
	}

	async createLead(plan: LeadChatPlan): Promise<Workstream> {
		const [lead] = WorkstreamMapper.fromRawList([
			await invoke('repositories.create-lead', {
				scope: leadScopeKey(plan.scope),
				workstreamId: plan.workstreamId,
				name: plan.name,
			}),
		]);
		if (!lead) throw new Error('Malini started the chat but could not read it back.');
		return lead;
	}

	syncBase(workstreamId: WorkstreamId): Promise<WorkstreamBaseSyncOutcome> {
		return invoke('repositories.sync-workstream-base', { workstreamId });
	}

	syncOwnPullRequests(): Promise<WorkstreamId[]> {
		return invoke('repositories.sync-own-pull-requests', undefined);
	}

	provisionDependencies(workstreamId: WorkstreamId): Promise<InstallOutcomeResult> {
		return invoke('repositories.provision-dependencies', { workstreamId });
	}

	async archive(workstreamId: WorkstreamId): Promise<void> {
		await invoke('repositories.archive-workstream', { workstreamId });
	}

	async saveForLater(workstreamId: WorkstreamId): Promise<void> {
		await invoke('repositories.save-workstream-for-later', { workstreamId });
	}

	restore(workstreamId: WorkstreamId): Promise<void> {
		return invoke('repositories.restore-workstream', { workstreamId });
	}

	clearMergedFromStarter(workstreamIds: readonly WorkstreamId[]): Promise<void> {
		return invoke('repositories.clear-merged-from-starter', { workstreamIds });
	}

	async delete(workstreamId: WorkstreamId): Promise<void> {
		await invoke('repositories.delete-workstream', { workstreamId });
	}

	revealInFinder(workstreamId: WorkstreamId): Promise<void> {
		return invoke('repositories.reveal-workstream', { workstreamId });
	}

	openInEditor(workstreamId: WorkstreamId): Promise<void> {
		return invoke('repositories.open-workstream-in-editor', { workstreamId });
	}

	push(workstreamId: WorkstreamId, expectedRepositoryFullName: string): Promise<string> {
		return invoke('repositories.push-workstream', {
			workstreamId,
			expectedRepositoryFullName,
		});
	}

	pull(workstreamId: WorkstreamId, baseBranch: string): Promise<string> {
		return invoke('repositories.pull-workstream', { workstreamId, baseBranch });
	}

	restartOnBase(
		workstreamId: WorkstreamId,
		baseBranch: string,
		mergedHeadSha: string,
		expectedRepositoryFullName: string,
	): Promise<string> {
		return invoke('repositories.restart-workstream-on-base', {
			workstreamId,
			baseBranch,
			mergedHeadSha,
			expectedRepositoryFullName,
		});
	}

	gitStatus(workstreamId: WorkstreamId): Promise<WorkstreamGitStatus> {
		return invoke('repositories.workstream-status', { workstreamId });
	}

	diff(workstreamId: WorkstreamId, path: string | null): Promise<string> {
		return invoke('repositories.workstream-diff', { workstreamId, path });
	}
}

export const workstreamsService = new WorkstreamsService();
