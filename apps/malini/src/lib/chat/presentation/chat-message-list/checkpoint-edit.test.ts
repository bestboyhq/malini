import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from '../render-state';
import {
	checkpointRestoreWarning,
	fileChangesSinceCheckpoint,
	type CheckpointItem,
} from './checkpoint-edit.svelte';

function prompt(key: string, seq: number): CheckpointItem {
	return { kind: 'user', key, seq, text: 'do the thing', checkpointId: `cp-${key}` };
}

function edited(path: string, seq: number): RenderItem {
	return { kind: 'file', key: `file-${seq}`, seq, path };
}

function editTool(path: string, seq: number): RenderItem {
	return {
		kind: 'tool',
		key: `tool-${seq}`,
		seq,
		tool: {
			name: 'Edit',
			startedAt: 0,
			completedAt: 1,
			input: { file_path: path },
			output: null,
			status: 'completed',
		},
	};
}

function run(runId: string, items: RenderItem[]): RunGroup {
	return {
		runId,
		items,
		terminal: 'completed',
		terminalText: '',
		superseded: false,
		obsoleted: false,
	};
}

describe('what a checkpoint restore would discard', () => {
	it('counts nothing when the prompt changed no files', () => {
		const item = prompt('p1', 1);
		expect(fileChangesSinceCheckpoint(item, [run('r1', [item])])).toBe(0);
	});

	it('ignores files edited before the prompt, inside the prompt’s own run', () => {
		const item = prompt('p1', 10);
		const runs = [run('r1', [edited('src/before.ts', 5), item, edited('src/after.ts', 20)])];
		expect(fileChangesSinceCheckpoint(item, runs)).toBe(1);
	});

	it('counts every later run in full', () => {
		const item = prompt('p1', 10);
		const runs = [
			run('r1', [item, edited('src/a.ts', 20)]),
			run('r2', [edited('src/b.ts', 1), edited('src/c.ts', 2)]),
		];
		expect(fileChangesSinceCheckpoint(item, runs)).toBe(3);
	});

	it('ignores runs that happened entirely before the prompt', () => {
		const item = prompt('p1', 10);
		const runs = [run('r0', [edited('src/old.ts', 1)]), run('r1', [item, edited('src/a.ts', 20)])];
		expect(fileChangesSinceCheckpoint(item, runs)).toBe(1);
	});

	it('counts a file once however many times it was touched, and however it was touched', () => {
		const item = prompt('p1', 10);
		const runs = [
			run('r1', [item, edited('src/a.ts', 20), editTool('src/a.ts', 21), edited('src/a.ts', 22)]),
		];
		expect(fileChangesSinceCheckpoint(item, runs)).toBe(1);
	});
});

describe('naming the cost rather than the mechanism', () => {
	it('says that nothing on disk is at stake when nothing is', () => {
		expect(checkpointRestoreWarning(0)).toBe(
			'Discards every reply after this message. No file changes have been made since.',
		);
	});

	it('counts in the singular for one file', () => {
		expect(checkpointRestoreWarning(1)).toContain('1 file change made since this message');
	});

	it('counts in the plural for more', () => {
		expect(checkpointRestoreWarning(7)).toContain('7 file changes made since this message');
	});
});
