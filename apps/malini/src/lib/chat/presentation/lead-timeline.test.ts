import { describe, expect, it } from 'vitest';
import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	ORPHAN_INTERRUPTED_ERROR,
} from '$contract/agent-state-machine';
import type { LeadDecision } from '$contract/leads';
import { REPORTS_PREAMBLE } from '$lib/chat/domain/deliveries';
import { leadTimeline, replyParts, timelineRows, type TimelineEntry } from './lead-timeline';
import type { RenderItem, RunGroup } from './render-state';

const AT = Date.parse('2026-10-27T10:20:00.000Z');
let seq = 0;

function next(): number {
	seq += 1;
	return seq;
}

function run(runId: string, items: RenderItem[], overrides: Partial<RunGroup> = {}): RunGroup {
	return {
		runId,
		items,
		terminal: 'completed',
		terminalText: '',
		failure: null,
		resumeAt: null,
		turnEnded: true,
		superseded: false,
		obsoleted: false,
		...overrides,
	};
}

function prompt(
	text: string,
	extra: Partial<Extract<RenderItem, { kind: 'user' }>> = {},
): RenderItem {
	const at = next();
	return { kind: 'user', key: `user-${at}`, seq: at, text, at: AT + at * 60_000, ...extra };
}

function reply(text: string): RenderItem {
	const at = next();
	return { kind: 'assistant', key: `assistant-${at}`, seq: at, text, at: AT + at * 60_000 };
}

function tool(
	name: string,
	input: Record<string, unknown> = {},
	output: unknown = 'ok',
	status: 'running' | 'completed' | 'failed' = 'completed',
): RenderItem {
	const at = next();
	return {
		kind: 'tool',
		key: `tool-${at}`,
		seq: at,
		tool: {
			name,
			startedAt: AT + at * 60_000,
			completedAt: status === 'running' ? null : AT + (at + 1) * 60_000,
			input,
			output,
			status,
		},
	};
}

function decision(
	answer: LeadDecision['answer'],
	askedAt = '2026-10-27T10:00:00.000Z',
): LeadDecision {
	return {
		id: 'decision-1',
		sessionId: 'lead-chat',
		workstreamId: 'lead',
		topic: 'Agent hours',
		question: 'Keep agent hours on your cards?',
		why: null,
		options: [
			{ label: 'Drop agent hours', note: null, picture: null },
			{ label: 'Keep both', note: null, picture: null },
		],
		recommended: 0,
		meanwhile: null,
		askedAt,
		answer,
	};
}

function kinds(entries: readonly TimelineEntry[]): string[] {
	return entries.map((entry) => entry.kind);
}

describe('the lead timeline', () => {
	it('folds every tool call between messages into one line and shows each turn by its last message', () => {
		const entries = leadTimeline(
			[
				run('one', [
					prompt('Build the public profile'),
					tool('Read', { file_path: '/repo/AGENTS.md' }),
					reply('Reading the repositories first.'),
					tool('Bash', { command: 'git log', description: 'Show recent commits' }),
					reply(
						'Both workstreams run on one contract.\n\nOutcome: Both workstreams run on one contract',
					),
				]),
			],
			[],
		);

		expect(kinds(entries)).toEqual(['prompt', 'work', 'reply']);
		const work = entries[1];
		expect(work?.kind === 'work' && work.steps).toEqual([
			'Read · /repo/AGENTS.md',
			'Show recent commits',
		]);
		expect(work?.kind === 'work' && work.verb).toBe('worked');
		const last = entries[2];
		expect(last?.kind === 'reply' && last.latest).toBe(true);
	});

	it('shows what the lead did through Malini as lines of their own', () => {
		const entries = leadTimeline(
			[
				run('one', [
					prompt('Go'),
					tool(
						'mcp__malini__workstreams_create',
						{ prompt: 'Build it' },
						JSON.stringify({ id: 'ws-a' }),
					),
					tool(
						'mcp__malini__workstreams_create',
						{ prompt: 'Ship it' },
						JSON.stringify({ id: 'ws-b' }),
					),
					tool(
						'mcp__malini__workstreams_send',
						{ workstream: 'ws-a', prompt: 'Use the plan' },
						JSON.stringify({ id: 'ws-a', name: 'Api', delivery: { id: 'd-1', status: 'waiting' } }),
					),
					tool('mcp__malini__plan_write', { text: '# Plan' }, JSON.stringify({ path: '/plan.md' })),
					tool('mcp__malini__decisions_ask', { topic: 'Agent hours' }),
					tool(
						'mcp__malini__workstreams_archive',
						{ workstream: 'ws-b' },
						JSON.stringify({ id: 'ws-b', name: 'Old' }),
					),
				]),
			],
			[],
		);

		expect(kinds(entries)).toEqual(['prompt', 'started', 'sent', 'plan', 'archived']);
		const started = entries[1];
		expect(started?.kind === 'started' && started.workstreams.map(({ id }) => id)).toEqual([
			'ws-a',
			'ws-b',
		]);
		const sent = entries[2];
		expect(sent?.kind === 'sent' && [sent.deliveryId, sent.delivered]).toEqual(['d-1', false]);
	});

	it('asks for an approval where the lead waits, and shows a job it runs only once it ran', () => {
		const merge = tool(
			'mcp__malini__jobs_run',
			{ job: 'Merge', workstream: 'ws-a' },
			null,
			'running',
		);
		const at = next();
		const approval: RenderItem = {
			kind: 'approval',
			key: `approval-${at}`,
			seq: at,
			sessionId: 'lead-chat',
			runId: 'one',
			approvalId: 'approval-1',
			reason: 'Claude wants to use a Malini tool',
			toolName: 'mcp__malini__jobs_run',
			input: { job: 'Merge', workstream: 'ws-a' },
			at: AT + at * 60_000,
		};
		const asking = leadTimeline(
			[run('one', [prompt('Ship it'), merge, approval], { turnEnded: false })],
			[],
		);
		expect(kinds(asking)).toEqual(['prompt', 'work', 'approval']);
		expect(asking[2]?.at).toBe(approval.kind === 'approval' ? approval.at : null);

		const ran = leadTimeline(
			[
				run('one', [
					prompt('Ship it'),
					merge.kind === 'tool'
						? { ...merge, tool: { ...merge.tool, status: 'completed', output: '{"job":"Merge"}' } }
						: merge,
					approval,
				]),
			],
			[],
		);
		expect(kinds(ran)).toEqual(['prompt', 'job', 'approval']);
	});

	it('shows a delivered report as the report of the workstream, and hides prompts Malini sends to continue', () => {
		const report = {
			workstreamId: 'ws-a',
			runId: 'child-run',
			status: 'succeeded' as const,
			outcome: 'Variants are ready',
			needs: null,
			media: [{ src: '.context/a.png', label: 'Variant A' }],
		};
		const entries = leadTimeline(
			[
				run('one', [prompt(`${REPORTS_PREAMBLE}\n\nfull text`, { reports: [report] })]),
				run('two', [prompt(CONTINUE_AFTER_PAUSE_PROMPT)]),
			],
			[],
		);

		expect(kinds(entries)).toEqual(['reports']);
		const reports = entries[0];
		expect(reports?.kind === 'reports' && reports.reports[0]).toMatchObject({
			workstreamId: 'ws-a',
			outcome: 'Variants are ready',
		});
	});

	it('reads the reports of a wake Malini sent before reports carried their own data', () => {
		const legacy = [
			'Malini woke you: work you started moved on.',
			'“Api analytics”, a workstream you started, failed its turn.\nOutcome: none\nNeeds: Which project?',
		].join('\n\n');
		const entries = leadTimeline([run('one', [prompt(legacy, { from: 'ws-a' })])], []);

		const reports = entries[0];
		expect(reports?.kind === 'reports' && reports.reports[0]).toMatchObject({
			workstreamId: 'ws-a',
			name: 'Api analytics',
			status: 'failed',
			outcome: null,
			needs: 'Which project?',
		});
	});

	it('places a decision at the time it was answered, and marks a closed app quietly', () => {
		const first = prompt('Go');
		const answered = reply('Done.');
		const between =
			first.kind === 'user' && answered.kind === 'assistant'
				? ((first.at ?? 0) + (answered.at ?? 0)) / 2
				: 0;
		const entries = leadTimeline(
			[
				run('one', [first, answered]),
				run('two', [prompt('Again')], {
					terminal: 'failed',
					terminalText: ORPHAN_INTERRUPTED_ERROR,
					turnEnded: false,
				}),
			],
			[
				decision({
					option: 1,
					by: 'you',
					reason: 'Hours matter',
					at: new Date(between).toISOString(),
				}),
			],
		);

		expect(kinds(entries)).toEqual(['prompt', 'decided', 'reply', 'prompt', 'stopped']);
		const stopped = entries.at(-1);
		expect(stopped?.kind === 'stopped' && stopped.terminal).toBe('closed');
	});

	it('keeps only the newest turn and the latest message vivid', () => {
		const entries = leadTimeline(
			[run('one', [prompt('First'), reply('Old answer')]), run('two', [prompt('Second')])],
			[],
		);

		expect(entries.map((entry) => [entry.kind, entry.current])).toEqual([
			['prompt', false],
			['reply', true],
			['prompt', true],
		]);
	});

	it('leaves out undone and obsoleted turns', () => {
		const entries = leadTimeline(
			[
				run('one', [prompt('Kept')]),
				run('two', [prompt('Undone')], { superseded: true }),
				run('three', [prompt('Obsolete')], { obsoleted: true }),
			],
			[],
		);

		expect(entries.map((entry) => entry.kind === 'prompt' && entry.text)).toEqual(['Kept']);
	});
});

describe('the rows of the lead timeline', () => {
	it('starts a day with its label and shows a time only when it changes', () => {
		const at = Date.parse('2026-10-27T10:20:00');
		const rows = timelineRows(
			[
				{ kind: 'prompt', key: 'a', at, current: false, text: 'One' },
				{ kind: 'prompt', key: 'b', at: at + 10_000, current: false, text: 'Two' },
				{ kind: 'prompt', key: 'c', at: at + 86_400_000, current: true, text: 'Three' },
			],
			at + 86_400_000,
		);

		expect(
			rows.map((row) => (row.kind === 'day' ? `day ${row.label}` : `${row.key} ${row.time}`)),
		).toEqual(['day Yesterday', 'a 10:20', 'b ', 'day Today', 'c 10:20']);
	});
});

describe('a reply of the lead', () => {
	it('folds to its Outcome line and opens without its footer', () => {
		expect(
			replyParts('Both build A.\n\n- Changed: sent A\n\nOutcome: A is in the plan\nNeeds: nothing'),
		).toEqual({ summary: 'A is in the plan', body: 'Both build A.\n\n- Changed: sent A' });
		expect(replyParts('Just an answer.')).toEqual({
			summary: 'Just an answer.',
			body: 'Just an answer.',
		});
	});
});
