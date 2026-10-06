import { describe, expect, it } from 'vitest';
import {
	createTokenSetClusterer,
	jaccardSimilarity,
	promptTokenSet,
	type RoutinePromptSample,
} from './prompt-clustering.service';

function sample(text: string, index: number): RoutinePromptSample {
	return {
		runId: `run-${index}`,
		sessionId: `session-${index}`,
		workstreamId: `workstream-${index % 2}`,
		text,
		submittedAt: `2026-09-18T00:00:0${index}.000Z`,
	};
}

describe('promptTokenSet', () => {
	it('normalizes case, punctuation, and short noise tokens', () => {
		expect(promptTokenSet('Run the linter, fix EVERYTHING! (v2)')).toEqual(
			new Set(['run', 'the', 'linter', 'fix', 'everything', 'v2']),
		);
		expect(promptTokenSet('a I . !')).toEqual(new Set());
	});
});

describe('jaccardSimilarity', () => {
	it('is 1 for identical sets, 0 for disjoint or empty sets', () => {
		const tokens = promptTokenSet('update the dependencies');
		expect(jaccardSimilarity(tokens, tokens)).toBe(1);
		expect(jaccardSimilarity(tokens, promptTokenSet('open a pull request'))).toBe(0);
		expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
	});
});

describe('createTokenSetClusterer', () => {
	it('clusters repeated prompts once and ignores distinct prompts', () => {
		const clusterer = createTokenSetClusterer();
		const clusters = clusterer.cluster([
			sample('Update the dependencies and run the tests', 0),
			sample('Open a pull request for the sidebar fix', 1),
			sample('update the dependencies and run the tests', 2),
			sample('Please update the dependencies and run the tests!', 3),
			sample('Rename the settings page', 4),
		]);
		expect(clusters).toHaveLength(1);
		const cluster = clusters[0];
		expect(cluster?.prompts.map(({ runId }) => runId)).toEqual(['run-0', 'run-2', 'run-3']);
		expect(cluster?.key).toBe('and dependencies run tests the update');
	});

	it('reports nothing when every prompt is distinct', () => {
		const clusterer = createTokenSetClusterer();
		const clusters = clusterer.cluster([
			sample('Update the dependencies', 0),
			sample('Open a pull request', 1),
			sample('Rename the settings page', 2),
			sample('Delete the stale worktrees', 3),
		]);
		expect(clusters).toEqual([]);
	});

	it('keeps the cluster key stable as near-duplicates join later', () => {
		const clusterer = createTokenSetClusterer({ minRepeatCount: 2 });
		const early = clusterer.cluster([
			sample('Run the linter and fix everything', 0),
			sample('run the linter and fix everything', 1),
		]);
		const late = clusterer.cluster([
			sample('Run the linter and fix everything', 0),
			sample('run the linter and fix everything', 1),
			sample('Run the linter and fix everything again', 2),
		]);
		expect(early).toHaveLength(1);
		expect(late).toHaveLength(1);
		expect(late[0]?.key).toBe(early[0]?.key);
		expect(late[0]?.prompts).toHaveLength(3);
	});

	it('honors the repeat floor and the similarity threshold', () => {
		const strict = createTokenSetClusterer({ similarityThreshold: 1, minRepeatCount: 2 });
		expect(
			strict.cluster([
				sample('update the dependencies', 0),
				sample('update the dependencies now', 1),
			]),
		).toEqual([]);
		expect(
			strict.cluster([sample('update the dependencies', 0), sample('Update the dependencies!', 1)]),
		).toHaveLength(1);
	});

	it('is deterministic for the same input', () => {
		const clusterer = createTokenSetClusterer();
		const prompts = [
			sample('Update the dependencies and run the tests', 0),
			sample('update the dependencies and run the tests', 1),
			sample('please update the dependencies and run the tests', 2),
		];
		expect(clusterer.cluster(prompts)).toEqual(clusterer.cluster(prompts));
	});
});
