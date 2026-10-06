export interface RoutinePromptSample {
	readonly runId: string;
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly text: string;
	readonly submittedAt: string;
}

export interface RoutinePromptCluster {
	readonly key: string;
	readonly prompts: readonly RoutinePromptSample[];
}

export interface RoutinePromptClusterer {
	cluster(prompts: readonly RoutinePromptSample[]): readonly RoutinePromptCluster[];
}

export interface TokenSetClustererOptions {
	readonly similarityThreshold?: number;
	readonly minRepeatCount?: number;
}

export const ROUTINE_CLUSTER_SIMILARITY_THRESHOLD = 0.6;
export const ROUTINE_CLUSTER_MIN_REPEAT_COUNT = 3;

export function createTokenSetClusterer(
	options: TokenSetClustererOptions = {},
): RoutinePromptClusterer {
	const threshold = options.similarityThreshold ?? ROUTINE_CLUSTER_SIMILARITY_THRESHOLD;
	const minRepeat = options.minRepeatCount ?? ROUTINE_CLUSTER_MIN_REPEAT_COUNT;
	return {
		cluster(prompts) {
			type Draft = { representative: ReadonlySet<string>; members: RoutinePromptSample[] };
			const drafts: Draft[] = [];
			for (const prompt of prompts) {
				const tokens = promptTokenSet(prompt.text);
				if (tokens.size === 0) continue;
				const home = drafts.find(
					(draft) => jaccardSimilarity(draft.representative, tokens) >= threshold,
				);
				if (home) home.members.push(prompt);
				else drafts.push({ representative: tokens, members: [prompt] });
			}
			return drafts
				.filter((draft) => draft.members.length >= minRepeat)
				.map((draft) => ({
					key: clusterKey(draft.representative),
					prompts: [...draft.members],
				}));
		},
	};
}

export function promptTokenSet(text: string): ReadonlySet<string> {
	return new Set(
		text
			.toLocaleLowerCase()
			.split(/[^a-z0-9]+/u)
			.filter((token) => token.length >= 2),
	);
}

export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	if (left.size === 0 && right.size === 0) return 0;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / (left.size + right.size - shared);
}

function clusterKey(representative: ReadonlySet<string>): string {
	return [...representative].sort().join(' ');
}
