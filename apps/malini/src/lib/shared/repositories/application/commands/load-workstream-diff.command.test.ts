import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate } from '$shared/repositories/application/provisioning.testkit';
import { workstreamDiffQuery } from '$shared/repositories/application/queries/workstream-diff.query.svelte';
import { workstreamDiffAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-diff.aggregate.svelte';
import { loadWorkstreamDiffCommand } from './load-workstream-diff.command';

const SAMPLE_DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 0123..4567 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,2 +1,3 @@',
	' line one',
	'-line two removed',
	'+line two added',
	'+line three added',
].join('\n');

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform({ diffs: { 'ws-1:src/a.ts': SAMPLE_DIFF } });
	setPlatformForTest(platform);
	workstreamDiffAggregate.reset();
});

afterEach(() => {
	setPlatformForTest(null);
	workstreamDiffAggregate.reset();
});

describe('loading a workstream diff', () => {
	it('reads the diff for one path and parses it into files and a per-path index', async () => {
		const diffFor = workstreamDiffQuery.data;

		loadWorkstreamDiffCommand('ws-1', 'src/a.ts');

		await vi.waitFor(() => expect(diffFor('ws-1', 'src/a.ts')).not.toBeNull());
		const diff = diffFor('ws-1', 'src/a.ts');
		expect(diff?.raw).toBe(SAMPLE_DIFF);
		expect(diff?.files.map((file) => file.path)).toEqual(['src/a.ts']);
		expect(diff?.diffByPath['src/a.ts']?.status).toBe('modified');
		expect(platform.calls).toEqual([
			{ command: 'repositories.workstream-diff', args: { workstreamId: 'ws-1', path: 'src/a.ts' } },
		]);
	});

	it('reads as not loaded again while a fresh read is in flight', async () => {
		loadWorkstreamDiffCommand('ws-1', 'src/a.ts');
		await vi.waitFor(() => expect(workstreamDiffQuery.data('ws-1', 'src/a.ts')).not.toBeNull());
		const read = gate<string>();
		platform.define('repositories.workstream-diff', () => read.promise);

		loadWorkstreamDiffCommand('ws-1', 'src/a.ts');

		expect(workstreamDiffQuery.data('ws-1', 'src/a.ts')).toBeNull();
		read.resolve('');
		await vi.waitFor(() =>
			expect(workstreamDiffQuery.data('ws-1', 'src/a.ts')).toEqual({
				files: [],
				diffByPath: {},
				raw: '',
			}),
		);
	});

	it('keeps only the newest read when two overlap', async () => {
		const first = gate<string>();
		const second = gate<string>();
		const reads = [first, second];
		platform.define('repositories.workstream-diff', () => {
			const next = reads.shift();
			if (!next) throw new Error('unexpected read');
			return next.promise;
		});

		loadWorkstreamDiffCommand('ws-1', null);
		loadWorkstreamDiffCommand('ws-1', null);
		second.resolve(SAMPLE_DIFF);
		await vi.waitFor(() => expect(workstreamDiffQuery.data('ws-1', null)?.raw).toBe(SAMPLE_DIFF));
		first.resolve('');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(workstreamDiffQuery.data('ws-1', null)?.raw).toBe(SAMPLE_DIFF);
	});

	it('shows an empty diff when the diff command fails', async () => {
		platform.define('repositories.workstream-diff', () => {
			throw new Error('diff unavailable');
		});

		loadWorkstreamDiffCommand('ws-1', null);

		await vi.waitFor(() =>
			expect(workstreamDiffQuery.data('ws-1', null)).toEqual({
				files: [],
				diffByPath: {},
				raw: '',
			}),
		);
	});

	it('parses the diff of one path into its changed files', async () => {
		loadWorkstreamDiffCommand('ws-1', 'src/a.ts');

		await vi.waitFor(() =>
			expect(workstreamDiffQuery.data('ws-1', 'src/a.ts')?.files.map((file) => file.path)).toEqual([
				'src/a.ts',
			]),
		);
		expect(workstreamDiffQuery.data('ws-1', 'src/a.ts')?.raw).toBe(SAMPLE_DIFF);
	});
});
