import type { Project } from '$shared/repositories/domain/repository';

type RawProject = {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	remoteUrl?: string | null;
};

export class ProjectMapper {
	static fromRawList(raws: unknown): Project[] {
		if (!Array.isArray(raws)) return [];
		return raws.filter(isRawProject).map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawProject): Project {
		return {
			id: raw.id,
			name: raw.name,
			repoPath: raw.repoPath,
			defaultBranch: raw.defaultBranch,
			remoteUrl: raw.remoteUrl ?? null,
		};
	}
}

function isRawProject(value: unknown): value is RawProject {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.repoPath === 'string' &&
		typeof value.defaultBranch === 'string' &&
		(value.remoteUrl === undefined ||
			value.remoteUrl === null ||
			typeof value.remoteUrl === 'string')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
