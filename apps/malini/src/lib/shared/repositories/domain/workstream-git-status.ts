import type { WorktreeOperation } from '$contract/repositories';

export type WorkstreamGitStatus = Readonly<{
	branch: string;
	dirtyPaths: readonly string[];
	conflictedPaths: readonly string[];
	conflictMarkerPaths: readonly string[];
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	mergeInProgress: boolean;
	operationInProgress: WorktreeOperation | null;
	headSha: string | null;
}>;
