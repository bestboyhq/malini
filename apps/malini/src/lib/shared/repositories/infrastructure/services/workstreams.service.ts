import { derivedCommitMessage } from '@malini-extension/repository';
import type { WorkstreamBaseSyncOutcome } from '$contract/repositories';
import { invoke } from '$shared/port/invoke';
import { workstreamBranch } from '$shared/repositories/domain/project-identity';
import type { Project } from '$shared/repositories/domain/repository';
import type {
	CreateWorkstreamInput,
	CreatedWorkstream,
	WorkstreamCheckpoint,
	Workstream,
	WorkstreamId,
} from '$shared/repositories/domain/workstream';
import type { WorkstreamGitStatus } from '$shared/repositories/domain/workstream-git-status';
import type { SavedWorkstreamWork } from '$shared/repositories/domain/workstream-retirement';
import { RetirementReceiptMapper } from '$shared/repositories/infrastructure/mappers/retirement-receipt.mapper';
import { WorkstreamMapper } from '$shared/repositories/infrastructure/mappers/workstream.mapper';
import { ProjectMapper } from '$shared/repositories/infrastructure/mappers/project.mapper';
import { markWorkstreamCreated } from './workstream-creation-marker.storage';

class WorkstreamsService {
	async listWorkstreams(): Promise<Workstream[]> {
		return WorkstreamMapper.fromRawList(await invoke('repositories.list-workstreams', undefined));
	}

	async listProjects(): Promise<Project[]> {
		return ProjectMapper.fromRawList(await invoke('repositories.list-repositories', undefined));
	}

	createProject(input: { repoUrl: string }): Promise<string> {
		return invoke('repositories.create-repository', { repoUrl: input.repoUrl });
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
			worktreePath,
		};
	}

	syncBase(workstreamId: WorkstreamId): Promise<WorkstreamBaseSyncOutcome> {
		return invoke('repositories.sync-workstream-base', { workstreamId });
	}

	provisionDependencies(workstreamId: WorkstreamId): Promise<string> {
		return invoke('repositories.provision-dependencies', { workstreamId });
	}

	async archive(workstreamId: WorkstreamId): Promise<SavedWorkstreamWork | null> {
		return RetirementReceiptMapper.savedWork(
			await invoke('repositories.archive-workstream', { workstreamId }),
		);
	}

	async delete(workstreamId: WorkstreamId): Promise<SavedWorkstreamWork | null> {
		return RetirementReceiptMapper.savedWork(
			await invoke('repositories.delete-workstream', { workstreamId }),
		);
	}

	revealInFinder(workstreamId: WorkstreamId): Promise<void> {
		return invoke('repositories.reveal-workstream', { workstreamId });
	}

	openInEditor(workstreamId: WorkstreamId): Promise<void> {
		return invoke('repositories.open-workstream-in-editor', { workstreamId });
	}

	commit(workstreamId: WorkstreamId, message: string): Promise<string> {
		return invoke('repositories.commit-workstream', { workstreamId, message });
	}

	async commitCheckpoint(workstreamId: WorkstreamId): Promise<WorkstreamCheckpoint> {
		const status = await this.gitStatus(workstreamId);
		const message = derivedCommitMessage({ changedPaths: [...status.dirtyPaths] });
		return { sha: await this.commit(workstreamId, message), message };
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

	gitStatus(workstreamId: WorkstreamId): Promise<WorkstreamGitStatus> {
		return invoke('repositories.workstream-status', { workstreamId });
	}

	diff(workstreamId: WorkstreamId, path: string | null): Promise<string> {
		return invoke('repositories.workstream-diff', { workstreamId, path });
	}
}

export const workstreamsService = new WorkstreamsService();
