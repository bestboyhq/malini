import { describe, expect, it } from 'vitest';
import type { RunGroup, RenderItem } from './render-state';
import {
	canonicalChangedPath,
	changedPathsMatch,
	linearizeRunTimeline,
	mutationRepresentedByTool,
} from './run-timeline';

function toolItem(
	name: string,
	input: Record<string, unknown>,
	seq = 2,
): Extract<RenderItem, { kind: 'tool' }> {
	return {
		kind: 'tool',
		key: `tool-${seq}`,
		seq,
		tool: {
			name,
			startedAt: null,
			completedAt: null,
			input,
			output: undefined,
			status: 'running',
		},
	};
}

function runWithEdit(name: string, toolPath: string, changedPath: string): RunGroup {
	return {
		runId: 'run-dedupe',
		superseded: false,
		obsoleted: false,
		terminal: null,
		terminalText: '',
		items: [
			toolItem(name, { file_path: toolPath }),
			{ kind: 'file', key: 'file', seq: 3, path: changedPath },
		],
	};
}

describe('linearizeRunTimeline', () => {
	it('keeps prompt, thought, read, answer, edit, and result in provider event order', () => {
		const run: RunGroup = {
			runId: 'run-1',
			superseded: false,
			obsoleted: false,
			terminal: 'completed',
			terminalText: 'done',
			items: [
				{ kind: 'user', key: 'user', seq: 1, text: 'Update it' },
				{
					kind: 'tool',
					key: 'read',
					seq: 3,
					tool: {
						name: 'Read',
						startedAt: 10,
						completedAt: 20,
						input: { path: 'README.md' },
						output: 'before',
						status: 'completed',
					},
				},
				{ kind: 'assistant', key: 'answer-1', seq: 4, text: 'I found it.' },
				{
					kind: 'tool',
					key: 'edit',
					seq: 5,
					tool: {
						name: 'Edit',
						startedAt: 30,
						completedAt: 40,
						input: { path: 'README.md' },
						output: 'ok',
						status: 'completed',
					},
				},
				{ kind: 'assistant', key: 'answer-2', seq: 7, text: 'Done.' },
				{ kind: 'terminal', key: 'terminal', seq: 8, terminal: 'completed', text: 'done' },
			],
		};

		const timeline = linearizeRunTimeline(run, [
			{ contentId: 'thinking', seq: 2, text: 'Inspect first', durationSeconds: 1 },
		]);

		expect(timeline.map((item) => `${item.seq}:${item.kind}`)).toEqual([
			'1:user',
			'2:thought',
			'3:tool',
			'4:assistant',
			'5:tool',
			'7:assistant',
		]);
	});

	it('removes only duplicate command/file bridge projections and preserves tool detail', () => {
		const run: RunGroup = {
			runId: 'run-2',
			superseded: false,
			obsoleted: false,
			terminal: null,
			terminalText: '',
			items: [
				{
					kind: 'tool',
					key: 'tool',
					seq: 2,
					tool: {
						name: 'Edit',
						startedAt: null,
						completedAt: null,
						input: { path: 'src/app.ts' },
						output: undefined,
						status: 'running',
					},
				},
				{ kind: 'file', key: 'file', seq: 3, path: 'src/app.ts' },
			],
		};

		const timeline = linearizeRunTimeline(run, []);
		expect(timeline).toHaveLength(1);
		expect(timeline[0]).toMatchObject({ kind: 'tool', key: 'tool' });
	});

	it('keeps an external file change after a Read of the same path', () => {
		const run: RunGroup = {
			runId: 'run-read-change',
			superseded: false,
			obsoleted: false,
			terminal: null,
			terminalText: '',
			items: [
				{
					kind: 'tool',
					key: 'read',
					seq: 2,
					tool: {
						name: 'Read',
						startedAt: null,
						completedAt: null,
						input: { path: 'src/app.ts' },
						output: 'before',
						status: 'completed',
					},
				},
				{ kind: 'file', key: 'external-edit', seq: 3, path: 'src/app.ts' },
			],
		};

		expect(linearizeRunTimeline(run, []).map((item) => item.kind)).toEqual(['tool', 'file']);
	});

	it('keeps a later change to an already-edited file as its own row', () => {
		const run = runWithEdit('Edit', 'src/app.ts', 'src/app.ts');
		run.items.push({ kind: 'file', key: 'external', seq: 9, path: 'src/other.ts' });

		expect(linearizeRunTimeline(run, []).map((item) => item.key)).toEqual(['tool-2', 'external']);
	});

	it('does not fold a bridge change that precedes every edit of that file', () => {
		const run: RunGroup = {
			runId: 'run-late-tool',
			superseded: false,
			obsoleted: false,
			terminal: null,
			terminalText: '',
			items: [
				{ kind: 'file', key: 'file', seq: 2, path: 'src/app.ts' },
				toolItem('Edit', { file_path: 'src/app.ts' }, 5),
			],
		};

		expect(linearizeRunTimeline(run, []).map((item) => item.kind)).toEqual(['file', 'tool']);
	});
});

describe('mutation tool detection', () => {
	it.each([
		['MultiEdit', 'src/app.ts'],
		['NotebookEdit', 'analysis.ipynb'],
		['apply_patch', 'src/app.ts'],
		['str_replace_editor', 'src/app.ts'],
		['mcp__filesystem__multi_edit', 'src/app.ts'],
		['Write', 'src/app.ts'],
		['Edit', 'src/app.ts'],
		['create_file', 'src/app.ts'],
	])('recognizes %s as a file mutation', (name, path) => {
		expect(mutationRepresentedByTool(toolItem(name, { file_path: path }))).toBe(path);
	});

	it.each(['Read', 'Grep', 'Glob', 'bash', 'TodoWrite', 'WebFetch'])(
		'leaves %s out of file mutations',
		(name) => {
			expect(mutationRepresentedByTool(toolItem(name, { file_path: 'src/app.ts' }))).toBeNull();
		},
	);

	it.each([
		['MultiEdit', 'src/app.ts'],
		['NotebookEdit', 'analysis.ipynb'],
		['apply_patch', 'src/app.ts'],
		['str_replace_editor', 'src/app.ts'],
	])('folds the bridge change row emitted by %s', (name, path) => {
		const timeline = linearizeRunTimeline(runWithEdit(name, path, path), []);
		expect(timeline.map((item) => item.kind)).toEqual(['tool']);
	});

	it('reads a notebook path from NotebookEdit input', () => {
		expect(
			mutationRepresentedByTool(toolItem('NotebookEdit', { notebook_path: 'analysis.ipynb' })),
		).toBe('analysis.ipynb');
	});
});

describe('changed path canonicalisation', () => {
	it('reduces workstream, relative, and separator spellings to one form', () => {
		const canonical = 'src/server.js';
		for (const spelling of [
			'src/server.js',
			'./src/server.js',
			'src\\server.js',
			'  src/server.js  ',
			'/Users/me/Library/Application Support/com.malini.app/workstreams/01JABC/src/server.js',
			'/Users/me/Library/Application Support/com.malini.app/worktrees/01JABC/src/server.js',
		]) {
			expect(canonicalChangedPath(spelling)).toBe(canonical);
		}
	});

	it('matches an absolute tool path against the bridge relative path', () => {
		expect(changedPathsMatch(canonicalChangedPath('/tmp/checkout/src/app.ts'), 'src/app.ts')).toBe(
			true,
		);
		expect(changedPathsMatch('src/app.ts', 'src/other.ts')).toBe(false);
		expect(changedPathsMatch('packages/a/index.ts', 'packages/b/index.ts')).toBe(false);
	});

	it('folds the bridge row when the model typed an absolute path', () => {
		const timeline = linearizeRunTimeline(
			runWithEdit('Edit', '/tmp/checkout/src/app.ts', 'src/app.ts'),
			[],
		);
		expect(timeline.map((item) => item.kind)).toEqual(['tool']);
	});

	it('folds the bridge row when the bridge reports the absolute path', () => {
		const timeline = linearizeRunTimeline(
			runWithEdit('Edit', 'src/app.ts', '/tmp/checkout/src/app.ts'),
			[],
		);
		expect(timeline.map((item) => item.kind)).toEqual(['tool']);
	});

	it('keeps a same-basename change in a different directory', () => {
		const timeline = linearizeRunTimeline(
			runWithEdit('Edit', 'packages/a/index.ts', 'packages/b/index.ts'),
			[],
		);
		expect(timeline.map((item) => item.kind)).toEqual(['tool', 'file']);
	});
});
