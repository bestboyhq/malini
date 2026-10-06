import type { Project, ProjectDto, Workstream, WorkstreamDto } from '$contract/repositories';
import { assessWorkstreamCheckout } from '$main/git/paths';
import { runGit } from '$main/git/run';

export type { ProjectDto, WorkstreamDto };

export async function readProjectRemoteUrl(repoPath: string): Promise<string | null> {
	try {
		const url = (await runGit(['-C', repoPath, 'remote', 'get-url', 'origin'])).trim();
		return url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

export function workstreamDto(appDataRoot: string, workstream: Workstream): WorkstreamDto {
	const health = assessWorkstreamCheckout(appDataRoot, workstream.id, workstream.path);
	return {
		...workstream,
		checkoutState: health.state,
		checkoutIssue: health.issue,
		resolvedPath: health.resolvedPath,
	};
}

export async function projectDto(project: Project): Promise<ProjectDto> {
	return { ...project, remoteUrl: await readProjectRemoteUrl(project.repoPath) };
}
