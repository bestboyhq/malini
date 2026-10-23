export interface PromptSample {
	readonly runId: string;
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly text: string;
	readonly submittedAt: string;
}

export interface PromptCluster {
	readonly key: string;
	readonly prompts: readonly PromptSample[];
}

export interface PromptClusterer {
	cluster(prompts: readonly PromptSample[]): readonly PromptCluster[];
}

export interface TokenSetClustererOptions {
	readonly similarityThreshold?: number;
	readonly minRepeatCount?: number;
}

export const PROMPT_CLUSTER_SIMILARITY_THRESHOLD = 0.6;
export const PROMPT_CLUSTER_MIN_REPEAT_COUNT = 3;
export const PROMPT_CLUSTER_MIN_PROMPT_TOKENS = 3;

export function createTokenSetClusterer(options: TokenSetClustererOptions = {}): PromptClusterer {
	const threshold = options.similarityThreshold ?? PROMPT_CLUSTER_SIMILARITY_THRESHOLD;
	const minRepeat = options.minRepeatCount ?? PROMPT_CLUSTER_MIN_REPEAT_COUNT;
	return {
		cluster(prompts) {
			type Draft = { representative: ReadonlySet<string>; members: PromptSample[] };
			const drafts: Draft[] = [];
			for (const prompt of prompts) {
				const tokens = promptTokenSet(prompt.text);
				// ponytail: a token count stands in for "is this a task"; replies like "done" or "go on" are shorter, a stop-word list or a model would tell them apart better
				if (tokens.size < PROMPT_CLUSTER_MIN_PROMPT_TOKENS) continue;
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
