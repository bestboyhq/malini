import type { Workstream } from './workstream';

const COMMON_BASE_BRANCH_NAMES = new Set(['main', 'master', 'develop', 'development', 'trunk']);

export const NEW_WORKSTREAM_NAME = 'New workstream';

const PLACEHOLDER_NAME = /^New workstream(?: \d+)?$/u;

export function isPlaceholderWorkstreamName(name: string): boolean {
	return PLACEHOLDER_NAME.test(name.trim());
}

export function uniqueWorkstreamName(takenNames: readonly string[]): string {
	const taken = new Set(takenNames.map(comparableName));
	let candidate = NEW_WORKSTREAM_NAME;
	for (let suffix = 2; taken.has(comparableName(candidate)); suffix += 1) {
		candidate = `${NEW_WORKSTREAM_NAME} ${suffix}`;
	}
	return candidate;
}

export function takenWorkstreamNames(workstreams: readonly Workstream[]): string[] {
	return workstreams
		.filter((workstream) => workstream.status !== 'archived')
		.flatMap((workstream) => [workstream.name, displayWorkstreamName(workstream)]);
}

function comparableName(name: string): string {
	return name.trim().toLowerCase();
}

export function displayWorkstreamName(
	workstream: Pick<Workstream, 'name' | 'baseBranch'>,
	repositoryFullName?: string | null,
): string {
	const name = stripRepositoryPrefix(workstream.name.trim(), repositoryFullName);
	const baseBranch = workstream.baseBranch.trim();
	if (name.length > 0 && !isBaseBranchName(name, baseBranch)) {
		return name;
	}
	return NEW_WORKSTREAM_NAME;
}

function stripRepositoryPrefix(name: string, repositoryFullName?: string | null): string {
	if (!repositoryFullName) {
		return name;
	}
	const repoName = repositoryFullName.split('/').filter(Boolean).at(-1) ?? repositoryFullName;
	const candidates = [repositoryFullName, repoName].filter(Boolean);
	for (const candidate of candidates) {
		const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
		const match = new RegExp(`^${escaped}\\s*(?:/|:|-)\\s*(.+)$`, 'iu').exec(name);
		if (match?.[1]) {
			return match[1].trim();
		}
	}
	return name;
}

function isBaseBranchName(name: string, baseBranch: string): boolean {
	const normalizedName = name.toLowerCase();
	if (COMMON_BASE_BRANCH_NAMES.has(normalizedName)) {
		return true;
	}
	if (baseBranch.length === 0) {
		return false;
	}
	return normalizedName === baseBranch.toLowerCase();
}
