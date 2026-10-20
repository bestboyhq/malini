import type { Workstream } from './workstream';

const ADJECTIVES = [
	'Bright',
	'Copper',
	'Electric',
	'Golden',
	'Lunar',
	'Neon',
	'North',
	'Signal',
	'Silver',
	'Swift',
] as const;

const NOUNS = [
	'Arc',
	'Beacon',
	'Circuit',
	'Harbor',
	'Launch',
	'Pulse',
	'Relay',
	'Summit',
	'Thread',
	'Voyage',
] as const;

const COMMON_BASE_BRANCH_NAMES = new Set(['main', 'master', 'develop', 'development', 'trunk']);

const NAME_COMBINATIONS = ADJECTIVES.length * NOUNS.length;

export function generatedWorkstreamName(seed: string): string {
	return nameAt(seedIndex(seed));
}

export function uniqueWorkstreamName(seed: string, takenNames: readonly string[]): string {
	const taken = new Set(takenNames.map(comparableName));
	const start = seedIndex(seed);
	for (let offset = 0; offset < NAME_COMBINATIONS; offset += 1) {
		const candidate = nameAt((start + offset) % NAME_COMBINATIONS);
		if (!taken.has(comparableName(candidate))) return candidate;
	}
	const base = nameAt(start);
	let suffix = 2;
	while (taken.has(comparableName(`${base} ${suffix}`))) suffix += 1;
	return `${base} ${suffix}`;
}

export function takenWorkstreamNames(workstreams: readonly Workstream[]): string[] {
	return workstreams
		.filter((workstream) => workstream.status !== 'archived')
		.flatMap((workstream) => [workstream.name, displayWorkstreamName(workstream)]);
}

function seedIndex(seed: string): number {
	return stableHash(seed || 'workstream') % NAME_COMBINATIONS;
}

function nameAt(index: number): string {
	const adjective = ADJECTIVES[index % ADJECTIVES.length] ?? 'Bright';
	const noun = NOUNS[Math.floor(index / ADJECTIVES.length) % NOUNS.length] ?? 'Thread';
	return `${adjective} ${noun}`;
}

function comparableName(name: string): string {
	return name.trim().toLowerCase();
}

export function displayWorkstreamName(
	workstream: Pick<Workstream, 'id' | 'name' | 'baseBranch'>,
	repositoryFullName?: string | null,
): string {
	const name = stripRepositoryPrefix(workstream.name.trim(), repositoryFullName);
	const baseBranch = workstream.baseBranch.trim();
	if (name.length > 0 && !isBaseBranchName(name, baseBranch)) {
		return name;
	}
	return generatedWorkstreamName(workstream.id);
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

function stableHash(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash;
}
