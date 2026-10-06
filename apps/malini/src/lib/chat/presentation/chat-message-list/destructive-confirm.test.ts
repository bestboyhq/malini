import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from '../render-state';
import { runFileChanges, runUndoTarget, runUndoWarning } from './destructive-confirm.svelte';

function prompt(checkpointId?: string, key = 'user-r1', seq = 0): RenderItem {
	return {
		kind: 'user',
		key,
		seq,
		text: 'do the thing',
		...(checkpointId ? { checkpointId } : {}),
	};
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

function run(
	items: RenderItem[],
	terminal: RunGroup['terminal'] = 'completed',
	runId = 'r1',
): RunGroup {
	return {
		runId,
		items,
		terminal,
		terminalText: '',
		superseded: false,
		obsoleted: false,
	};
}

describe('what undoing one run would discard', () => {
	it('counts a file once however many times it was touched, and however it was touched', () => {
		const changes = run([
			prompt('cp-1'),
			edited('src/a.ts', 1),
			editTool('src/a.ts', 2),
			edited('src/b.ts', 3),
		]);
		expect(runFileChanges(changes)).toBe(2);
	});

	it('offers no undo for a run that changed nothing', () => {
		const only = run([prompt('cp-1')]);
		expect(runUndoTarget(only, [only])).toBeNull();
	});

	it('offers no undo for a run whose prompt bound no checkpoint', () => {
		const only = run([prompt(), edited('src/a.ts', 1)]);
		expect(runUndoTarget(only, [only])).toBeNull();
	});

	it('offers no undo while the run is still open', () => {
		const only = run([prompt('cp-1'), edited('src/a.ts', 1)], null);
		expect(runUndoTarget(only, [only])).toBeNull();
	});

	it('offers undo for a run that failed or was cancelled after changing files', () => {
		for (const terminal of ['failed', 'cancelled'] as const) {
			const only = run([prompt('cp-1'), edited('src/a.ts', 1)], terminal);
			expect(runUndoTarget(only, [only])).toEqual({ checkpointId: 'cp-1', changeCount: 1 });
		}
	});

	it('names the checkpoint and the cost together', () => {
		const only = run([prompt('cp-1'), edited('src/a.ts', 1), edited('src/b.ts', 2)]);
		expect(runUndoTarget(only, [only])).toEqual({ checkpointId: 'cp-1', changeCount: 2 });
	});

	it('counts every later run, because undoing this one deletes those too', () => {
		const first = run([prompt('cp-1'), edited('src/a.ts', 1)], 'completed', 'r1');
		const second = run(
			[prompt('cp-2', 'user-r2', 10), edited('src/b.ts', 11), edited('src/c.ts', 12)],
			'completed',
			'r2',
		);
		const third = run([prompt('cp-3', 'user-r3', 20), edited('src/d.ts', 21)], 'completed', 'r3');
		const transcript = [first, second, third];

		expect(runUndoTarget(first, transcript)).toEqual({ checkpointId: 'cp-1', changeCount: 4 });
		expect(runUndoTarget(second, transcript)).toEqual({ checkpointId: 'cp-2', changeCount: 3 });
		expect(runUndoTarget(third, transcript)).toEqual({ checkpointId: 'cp-3', changeCount: 1 });
	});

	it('counts a file once when several of the doomed runs touched it', () => {
		const first = run([prompt('cp-1'), edited('src/a.ts', 1)], 'completed', 'r1');
		const second = run([prompt('cp-2', 'user-r2', 10), edited('src/a.ts', 11)], 'completed', 'r2');

		expect(runUndoTarget(first, [first, second])?.changeCount).toBe(1);
	});

	it('still needs this run to have changed something before it offers anything', () => {
		const first = run([prompt('cp-1')], 'completed', 'r1');
		const second = run([prompt('cp-2', 'user-r2', 10), edited('src/b.ts', 11)], 'completed', 'r2');

		expect(runUndoTarget(first, [first, second])).toBeNull();
	});
});

describe('naming what undo removes', () => {
	it('counts in the singular for one file', () => {
		expect(runUndoWarning(1)).toBe(
			'Discards 1 file change made since this turn, and every reply from this one on.',
		);
	});

	it('counts in the plural for more', () => {
		expect(runUndoWarning(4)).toBe(
			'Discards 4 file changes made since this turn, and every reply from this one on.',
		);
	});
});
