import { describe, expect, it } from 'vitest';
import {
	ACTIVITY_GROUP_DETAIL_MAX_CHARS,
	ACTIVITY_GROUP_MIN_ITEMS,
	groupRunTimeline,
	type ActivityGroup,
	type GroupedRunTimelineItem,
} from './activity-group';
import type { RunTimelineItem } from './run-timeline';

let nextSeq = 0;

function seq(): number {
	nextSeq += 1;
	return nextSeq;
}

function tool(
	name: string,
	input: Record<string, unknown> = {},
	options: { key?: string; status?: 'running' | 'completed' | 'failed' } = {},
): RunTimelineItem {
	const at = seq();
	return {
		kind: 'tool',
		key: options.key ?? `tool-${at}`,
		seq: at,
		tool: {
			name,
			startedAt: null,
			completedAt: null,
			input,
			output: undefined,
			status: options.status ?? 'completed',
		},
	};
}

function command(exitCode: number | null = 0, error?: string): RunTimelineItem {
	const at = seq();
	return {
		kind: 'command',
		key: `command-${at}`,
		seq: at,
		command: 'pnpm test',
		exitCode,
		output: null,
		...(error === undefined ? {} : { error }),
	};
}

function file(path: string): RunTimelineItem {
	const at = seq();
	return { kind: 'file', key: `file-${at}`, seq: at, path };
}

function thought(durationSeconds: number | null = null): RunTimelineItem {
	const at = seq();
	return {
		kind: 'thought',
		key: `thought-${at}`,
		seq: at,
		contentId: `content-${at}`,
		text: 'Considering the options',
		durationSeconds,
	};
}

function assistant(text = 'Here is what I found.'): RunTimelineItem {
	const at = seq();
	return { kind: 'assistant', key: `assistant-${at}`, seq: at, text };
}

function onlyGroup(items: readonly RunTimelineItem[]): ActivityGroup {
	const grouped = groupRunTimeline(items);
	expect(grouped).toHaveLength(1);
	const group = grouped[0];
	if (!group) throw new Error('expected a group');
	if (group.kind !== 'activity-group') throw new Error(`expected a group, got ${group.kind}`);
	return group;
}

function kinds(grouped: readonly GroupedRunTimelineItem[]): string[] {
	return grouped.map((item) => item.kind);
}

describe('groupRunTimeline folding', () => {
	it('returns nothing for an empty timeline', () => {
		expect(groupRunTimeline([])).toEqual([]);
	});

	it('folds from two items up', () => {
		expect(ACTIVITY_GROUP_MIN_ITEMS).toBe(2);
	});

	it('leaves a single tool call unfolded', () => {
		const read = tool('Read', { file_path: 'src/git.rs' });
		expect(groupRunTimeline([read])).toEqual([read]);
	});

	it('leaves a lone thought unfolded so its own disclosure still owns it', () => {
		const lone = thought(4);
		expect(groupRunTimeline([lone])).toEqual([lone]);
	});

	it('folds two consecutive tool calls into one group', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
		]);
		expect(group.items).toHaveLength(2);
	});

	it('folds tools, commands, files and thoughts into the same group', () => {
		const group = onlyGroup([
			thought(1),
			tool('Read', { file_path: 'src/a.ts' }),
			command(0),
			file('src/b.ts'),
		]);
		expect(group.items).toHaveLength(4);
	});

	it('splits into two groups when prose sits between the tool calls', () => {
		const grouped = groupRunTimeline([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
			assistant(),
			tool('Read', { file_path: 'src/c.ts' }),
			tool('Read', { file_path: 'src/d.ts' }),
		]);
		expect(kinds(grouped)).toEqual(['activity-group', 'assistant', 'activity-group']);
	});

	it('keeps a single tool call between two prose blocks unfolded', () => {
		const read = tool('Read', { file_path: 'src/a.ts' });
		const grouped = groupRunTimeline([assistant(), read, assistant()]);
		expect(kinds(grouped)).toEqual(['assistant', 'tool', 'assistant']);
		expect(grouped[1]).toBe(read);
	});

	it.each<RunTimelineItem>([
		{ kind: 'user', key: 'user', seq: 100, text: 'Fix it' },
		{ kind: 'assistant', key: 'assistant', seq: 100, text: 'Sure' },
		{ kind: 'plan', key: 'plan', seq: 100, text: '1. Look' },
		{
			kind: 'approval',
			key: 'approval',
			seq: 100,
			sessionId: 's',
			runId: 'r',
			approvalId: 'a',
			reason: 'Write access',
		},
		{
			kind: 'question',
			key: 'question',
			seq: 100,
			sessionId: 's',
			runId: 'r',
			questionId: 'q',
			questions: [],
		},
		{ kind: 'unknown', key: 'unknown', seq: 100, raw: {} },
	])('never folds a $kind row, and breaks the group around it', (breaker) => {
		const grouped = groupRunTimeline([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
			breaker,
			tool('Read', { file_path: 'src/c.ts' }),
			tool('Read', { file_path: 'src/d.ts' }),
		]);
		expect(kinds(grouped)).toEqual(['activity-group', breaker.kind, 'activity-group']);
	});

	it('preserves every timeline item exactly once, in order', () => {
		const items = [
			assistant(),
			tool('Read', { file_path: 'src/a.ts' }),
			command(0),
			assistant(),
			thought(2),
		];
		const flattened = groupRunTimeline(items).flatMap((entry) =>
			entry.kind === 'activity-group' ? [...entry.items] : [entry],
		);
		expect(flattened).toEqual(items);
	});
});

describe('groupRunTimeline verbs', () => {
	it('says Explored when the group only reads and searches', () => {
		expect(
			onlyGroup([tool('Read', { file_path: 'src/a.ts' }), tool('Grep', { pattern: 'todo' })]).verb,
		).toBe('Explored');
	});

	it('says Edited as soon as anything was edited', () => {
		expect(
			onlyGroup([tool('Read', { file_path: 'src/a.ts' }), tool('Edit', { file_path: 'src/a.ts' })])
				.verb,
		).toBe('Edited');
	});

	it('says Ran when the group is only commands', () => {
		expect(onlyGroup([command(0), tool('Bash', { command: 'ls' })]).verb).toBe('Ran');
	});

	it('says Thought when the group is only thoughts', () => {
		expect(onlyGroup([thought(3), thought(4)]).verb).toBe('Thought');
	});

	it('says Worked for a mix that is neither pure exploration nor pure commands', () => {
		expect(
			onlyGroup([tool('Read', { file_path: 'src/a.ts' }), tool('Bash', { command: 'ls' })]).verb,
		).toBe('Worked');
	});

	it('lets the tool mix pick the verb even when thoughts are interleaved', () => {
		expect(onlyGroup([thought(2), tool('Read', { file_path: 'src/a.ts' }), thought(1)]).verb).toBe(
			'Explored',
		);
		expect(onlyGroup([thought(2), command(0)]).verb).toBe('Ran');
	});

	it.each<[string, Record<string, unknown>, string]>([
		['Read', { file_path: 'src/a.ts' }, 'Exploring'],
		['Edit', { file_path: 'src/a.ts' }, 'Editing'],
		['Bash', { command: 'ls' }, 'Running'],
		['WebFetch', { url: 'https://example.com' }, 'Working'],
	])('uses the present participle while a %s call is still running', (name, input, expected) => {
		expect(onlyGroup([tool(name, input), tool(name, input, { status: 'running' })]).verb).toBe(
			expected,
		);
	});

	it('never treats a thought or a bridge file row as unfinished work', () => {
		expect(onlyGroup([thought(3), thought(null)]).verb).toBe('Thought');
		expect(onlyGroup([thought(null), file('src/a.ts')]).verb).toBe('Edited');
		expect(onlyGroup([thought(3), command(null)]).verb).toBe('Running');
	});

	it('keeps the present participle when a failure and a running item coexist', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/a.ts' }, { status: 'failed' }),
			tool('Read', { file_path: 'src/b.ts' }, { status: 'running' }),
		]);
		expect(group.verb).toBe('Exploring');
		expect(group.status).toBe('failed');
	});
});

describe('groupRunTimeline status', () => {
	it('reports completed when every item finished cleanly', () => {
		expect(onlyGroup([tool('Read'), command(0)]).status).toBe('completed');
	});

	it('lets running win over completed', () => {
		expect(onlyGroup([tool('Read'), tool('Read', {}, { status: 'running' })]).status).toBe(
			'running',
		);
	});

	it('lets failed win over running so a collapsed group never hides a failure', () => {
		expect(
			onlyGroup([tool('Read', {}, { status: 'running' }), tool('Read', {}, { status: 'failed' })])
				.status,
		).toBe('failed');
	});

	it('never reads a non-zero exit code as a failure', () => {
		expect(onlyGroup([tool('Read'), command(1)]).status).toBe('completed');
		expect(onlyGroup([tool('Read'), command(127)]).status).toBe('completed');
	});

	it('treats a command the tool itself marked as an error as a failure', () => {
		expect(onlyGroup([tool('Read'), command(124, 'command timed out')]).status).toBe('failed');
	});

	it('treats a command with no exit code yet as running', () => {
		expect(onlyGroup([tool('Read'), command(null)]).status).toBe('running');
	});
});

describe('groupRunTimeline failures', () => {
	it('carries no failure when nothing failed', () => {
		expect(onlyGroup([tool('Read'), command(1)]).failures).toEqual([]);
	});

	it('surfaces the tool error message, not just the fact of failure', () => {
		const failed = tool('Bash', { command: 'pnpm test' }, { status: 'failed' });
		if (failed.kind !== 'tool') throw new Error('expected a tool item');
		failed.tool.error = 'command timed out\nstdout:\nrunning 402 tests';

		const group = onlyGroup([tool('Read', { file_path: 'src/a.ts' }), failed]);
		expect(group.failures).toEqual([
			{ key: failed.key, label: 'Bash · pnpm test', message: 'command timed out' },
		]);
	});

	it("leads a failed shell row with the agent's own label when it supplied one", () => {
		const failed = tool(
			'Bash',
			{
				command: 'grep -rn BashRunResult agent-bridge/src',
				description: 'Check BashRunResult import',
			},
			{ status: 'failed' },
		);
		if (failed.kind !== 'tool') throw new Error('expected a tool item');
		failed.tool.error = 'blocked by the checkout sandbox';

		expect(onlyGroup([tool('Read'), failed]).failures[0]?.label).toBe('Check BashRunResult import');
	});

	it('carries a bridge command row failure with its own command and reason', () => {
		const failed = command(127, 'command not found');
		const group = onlyGroup([tool('Read'), failed]);
		expect(group.failures).toEqual([
			{ key: failed.key, label: 'pnpm test', message: 'command not found' },
		]);
	});

	it("leads a failed bridge command row with the agent's own label when it carried one", () => {
		const failed = command(124, 'command timed out');
		if (failed.kind !== 'command') throw new Error('expected a command item');
		failed.description = 'Run the desktop unit suite';
		expect(onlyGroup([tool('Read'), failed]).failures[0]?.label).toBe('Run the desktop unit suite');
	});

	it('names the tool when a failure arrived with no message at all', () => {
		const failed = tool('Bash', { command: 'pnpm test' }, { status: 'failed' });
		expect(onlyGroup([tool('Read'), failed]).failures[0]?.message).toBe('Bash failed');
	});

	it('states the reason without the whole transcript the command printed', () => {
		const failed = tool('Bash', { command: 'pnpm test' }, { status: 'failed' });
		if (failed.kind !== 'tool') throw new Error('expected a tool item');
		failed.tool.error = `${'x'.repeat(400)}\nstderr:\nnoise`;

		const failure = onlyGroup([tool('Read'), failed]).failures[0];
		if (!failure) throw new Error('expected a failure');
		const message = failure.message;
		expect(message).toHaveLength(240);
		expect(message.endsWith('…')).toBe(true);
	});

	it('lists every failure in the group, in order', () => {
		const first = tool('Read', { file_path: 'src/a.ts' }, { status: 'failed' });
		const second = command(124, 'command timed out');
		expect(onlyGroup([first, tool('Read'), second]).failures.map((entry) => entry.key)).toEqual([
			first.key,
			second.key,
		]);
	});
});

describe('groupRunTimeline detail', () => {
	it('names a single file by basename, without its directory', () => {
		expect(
			onlyGroup([
				tool('Read', { file_path: 'src/lib/chat/is-dev.util.ts' }),
				tool('Read', { file_path: 'src/lib/chat/is-dev.util.ts' }),
			]).detail,
		).toBe('is-dev.util.ts');
	});

	it('counts distinct files rather than naming them', () => {
		expect(
			onlyGroup([
				tool('Read', { file_path: 'src/a.ts' }),
				tool('Read', { file_path: 'src/b.ts' }),
				tool('Read', { file_path: 'src/a.ts' }),
			]).detail,
		).toBe('2 files');
	});

	it('counts a bridge file row as a file', () => {
		expect(onlyGroup([file('src/a.ts'), file('src/b.ts')]).detail).toBe('2 files');
	});

	it('aggregates files, searches and commands in Cursor order', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/lib/is-dev.util.ts' }),
			tool('Grep', { pattern: 'isDev' }),
			...Array.from({ length: 7 }, () => tool('Bash', { command: 'ls' })),
		]);
		expect(group.detail).toBe('is-dev.util.ts, 1 search, ran 7 commands');
	});

	it('pluralises the search clause', () => {
		expect(
			onlyGroup([tool('Grep', { pattern: 'todo' }), tool('Glob', { glob: '**/*.ts' })]).detail,
		).toBe('2 searches');
		expect(
			onlyGroup([tool('Grep', { pattern: 'todo' }), tool('Bash', { command: 'ls' })]).detail,
		).toBe('1 search, ran 1 command');
	});

	it('pluralises the command clause', () => {
		expect(onlyGroup([command(0), command(0), command(0)]).detail).toBe('ran 3 commands');
		expect(onlyGroup([command(0), file('src/a.ts')]).detail).toBe('a.ts, ran 1 command');
	});

	it('reports a duration for a group that is only thoughts', () => {
		expect(onlyGroup([thought(3), thought(4)]).detail).toBe('for 7s');
	});

	it('falls back to a step count when a thought group has no duration', () => {
		expect(onlyGroup([thought(null), thought(null)]).detail).toBe('2 steps');
	});

	it('falls back to a step count when nothing nameable happened', () => {
		const opaque = { url: 'https://example.com' };
		expect(onlyGroup([tool('WebFetch', opaque), tool('WebFetch', opaque)]).detail).toBe('2 steps');
	});

	it('drops the least important clause before exceeding the cap', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/an-extremely-long-component-file-name.stories.tsx' }),
			tool('Grep', { pattern: 'todo' }),
			...Array.from({ length: 7 }, () => tool('Bash', { command: 'ls' })),
		]);
		expect(group.detail).toBe('an-extremely-long-component-file-name.stories.tsx, 1 search');
		expect(group.detail.length).toBeLessThanOrEqual(ACTIVITY_GROUP_DETAIL_MAX_CHARS);
	});

	it('truncates a single clause that is longer than the cap on its own', () => {
		const long = `${'a'.repeat(70)}.ts`;
		const group = onlyGroup([tool('Read', { file_path: long }), tool('Read', { file_path: long })]);
		expect(group.detail).toHaveLength(ACTIVITY_GROUP_DETAIL_MAX_CHARS);
		expect(group.detail.endsWith('…')).toBe(true);
	});
});

describe('groupRunTimeline action kinds', () => {
	it('lists each action kind once, in first-appearance order', () => {
		const group = onlyGroup([
			tool('Bash', { command: 'ls' }),
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Bash', { command: 'ls' }),
			file('src/b.ts'),
		]);
		expect(group.actionKinds).toEqual(['command', 'read', 'edit']);
	});

	it('leaves a pure thought group without any action kind', () => {
		expect(onlyGroup([thought(1), thought(2)]).actionKinds).toEqual([]);
	});
});

describe('groupRunTimeline keys', () => {
	it('derives the key from the first item and keeps it as the group grows', () => {
		const first = tool('Read', { file_path: 'src/a.ts' }, { key: 'tool-first' });
		const second = tool('Read', { file_path: 'src/b.ts' }, { key: 'tool-second' });
		const third = tool('Read', { file_path: 'src/c.ts' }, { key: 'tool-third' });

		const growing = onlyGroup([first, second]);
		const grown = onlyGroup([first, second, third]);

		expect(growing.key).toBe('activity-tool-first');
		expect(grown.key).toBe(growing.key);
	});

	it('gives two groups in one timeline distinct keys', () => {
		const grouped = groupRunTimeline([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
			assistant(),
			tool('Read', { file_path: 'src/c.ts' }),
			tool('Read', { file_path: 'src/d.ts' }),
		]);
		const keys = grouped.map((item) => item.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('is deterministic across repeated calls on the same timeline', () => {
		const items = [
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Edit', { file_path: 'src/b.ts' }),
			assistant(),
			command(0),
			command(0),
		];
		expect(groupRunTimeline(items)).toEqual(groupRunTimeline(items));
	});
});
