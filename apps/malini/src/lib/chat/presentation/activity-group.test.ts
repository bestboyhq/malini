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
	options: { key?: string; status?: 'running' | 'completed' | 'failed'; output?: unknown } = {},
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
			output: options.output,
			status: options.status ?? 'completed',
		},
	};
}

function startWorkstream(
	id: string,
	status: 'running' | 'completed' | 'failed' = 'completed',
): RunTimelineItem {
	return tool(
		'mcp__malini__workstreams_create',
		{ repository: 'acme/api' },
		{ status, output: status === 'completed' ? JSON.stringify({ id, name: id }) : undefined },
	);
}

function command(exitCode = 0): RunTimelineItem {
	const at = seq();
	return { kind: 'command', key: `command-${at}`, seq: at, command: 'pnpm test', exitCode };
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

	it('never folds a thought, so the narration between tool calls stays readable', () => {
		const narration = thought(4);
		const grouped = groupRunTimeline([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
			narration,
			tool('Read', { file_path: 'src/c.ts' }),
			tool('Read', { file_path: 'src/d.ts' }),
		]);
		expect(kinds(grouped)).toEqual(['activity-group', 'thought', 'activity-group']);
		expect(grouped[1]).toBe(narration);
	});

	it('never folds a compaction, so the turn shows where the agent lost its detail', () => {
		const compaction = tool('Compact');
		const grouped = groupRunTimeline([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
			compaction,
			tool('Read', { file_path: 'src/c.ts' }),
			tool('Read', { file_path: 'src/d.ts' }),
		]);
		expect(kinds(grouped)).toEqual(['activity-group', 'tool', 'activity-group']);
		expect(grouped[1]).toBe(compaction);
	});

	it('folds two consecutive tool calls into one group', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/a.ts' }),
			tool('Read', { file_path: 'src/b.ts' }),
		]);
		expect(group.items).toHaveLength(2);
	});

	it('folds tools, commands and files into the same group', () => {
		const group = onlyGroup([
			tool('Read', { file_path: 'src/a.ts' }),
			command(0),
			file('src/b.ts'),
		]);
		expect(group.items).toHaveLength(3);
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

	it('says Worked for a mix that is neither pure exploration nor pure commands', () => {
		expect(
			onlyGroup([tool('Read', { file_path: 'src/a.ts' }), tool('Bash', { command: 'ls' })]).verb,
		).toBe('Worked');
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

	it('never treats a bridge file row as unfinished work', () => {
		expect(onlyGroup([file('src/a.ts'), file('src/b.ts')]).verb).toBe('Edited');
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

	it('reads a shell tool that only exited non-zero as finished, not failed', () => {
		const exited = tool('Bash', { command: 'grep -rn missing src' }, { status: 'failed' });
		if (exited.kind !== 'tool') throw new Error('expected a tool item');
		exited.tool.error = 'Exit code 1\n';

		const group = onlyGroup([tool('Read'), exited]);
		expect(group.status).toBe('completed');
		expect(group.failures).toEqual([]);
		expect(group.exitCodes).toEqual([1]);
	});

	it('reads a call auto mode blocked as settled, not failed', () => {
		const blocked = tool(
			'Bash',
			{ command: 'curl -X POST https://example.com' },
			{ status: 'failed' },
		);
		if (blocked.kind !== 'tool') throw new Error('expected a tool item');
		blocked.tool.error =
			'Permission for this action was denied by the Claude Code auto mode classifier.';
		blocked.tool.autoModeReason = 'Data Exfiltration';

		const group = onlyGroup([tool('Read'), blocked]);
		expect(group.status).toBe('completed');
		expect(group.failures).toEqual([]);
	});

	it('counts only the calls that ran, and calls a group of blocked calls tried', () => {
		function unchecked(): RunTimelineItem {
			const item = tool('Bash', { command: 'node -e 1' }, { status: 'failed' });
			if (item.kind !== 'tool') throw new Error('expected a tool item');
			item.tool.autoModeReason = 'Classifier unavailable';
			return item;
		}

		expect(onlyGroup([unchecked(), tool('Bash', { command: 'node -e 1' })])).toMatchObject({
			verb: 'Ran',
			detail: '1 command',
		});
		expect(onlyGroup([unchecked(), unchecked()])).toMatchObject({
			verb: 'Tried',
			detail: '2 calls',
			actionKinds: [],
		});
	});

	it('keeps every non-zero exit visible on the collapsed group, and no zero exit', () => {
		expect(onlyGroup([tool('Read'), command(0), command(127)]).exitCodes).toEqual([127]);
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
		const second = tool('Bash', { command: 'pnpm test' }, { status: 'failed' });
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

	it('aggregates files, searches and commands in that order', () => {
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
		expect(onlyGroup([command(0), command(0), command(0)]).detail).toBe('3 commands');
		expect(onlyGroup([command(0), tool('mcp__malini__browser_open')]).detail).toBe('1 command');
		expect(onlyGroup([command(0), file('src/a.ts')]).detail).toBe('a.ts, ran 1 command');
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

	it('keeps consecutive thoughts as their own rows', () => {
		expect(kinds(groupRunTimeline([thought(1), thought(2)]))).toEqual(['thought', 'thought']);
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

describe('groupRunTimeline started workstreams', () => {
	it('shows every workstream a run started in one card where the first one started', () => {
		const grouped = groupRunTimeline([
			assistant('I start one workstream per app.'),
			startWorkstream('api'),
			command(),
			startWorkstream('site'),
			startWorkstream('broken', 'failed'),
			startWorkstream('pending', 'running'),
			assistant('Both are running.'),
		]);
		expect(kinds(grouped)).toEqual(['assistant', 'workstreams', 'activity-group', 'assistant']);
		expect(grouped[1]).toMatchObject({ kind: 'workstreams', workstreamIds: ['api', 'site'] });
	});

	it('keeps a call whose answer names no workstream as a tool row', () => {
		const unnamed = tool('mcp__malini__workstreams_create', {}, { output: 'not json' });
		expect(kinds(groupRunTimeline([unnamed]))).toEqual(['tool']);
	});
});
