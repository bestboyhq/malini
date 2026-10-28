import { describe, expect, it } from 'vitest';
import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
	PAUSED_FOR_EXIT_ERROR,
} from '$contract/agent-state-machine';
import type { LeadDecision } from '$contract/leads';
import { leadBrief, type BriefEvent } from './lead-brief';

type Entry = Omit<BriefEvent, 'seq'>;

const NAMES: Readonly<Record<string, string>> = {
	'ws-api': 'Api analytics',
	'ws-site': 'Site analytics',
};

function named(workstreamId: string): string {
	return NAMES[workstreamId] ?? 'A workstream';
}

function at(minute: number, day = 28): string {
	return new Date(Date.UTC(2026, 9, day, 12, minute)).toISOString();
}

function events(...entries: Entry[]): BriefEvent[] {
	return entries.map((entry, index) => ({ seq: index + 1, ...entry }));
}

function user(runId: string, text: string, minute: number, extra: object = {}): Entry {
	return { runId, kind: 'user.message', payload: { text, ...extra }, at: at(minute) };
}

function said(runId: string, text: string, minute: number): Entry {
	return { runId, kind: 'assistant.message', payload: { text }, at: at(minute) };
}

function started(
	runId: string,
	name: string,
	toolCallId: string,
	input: object,
	minute: number,
): Entry {
	return { runId, kind: 'tool.started', payload: { name, toolCallId, input }, at: at(minute) };
}

function completed(runId: string, toolCallId: string, output: unknown, minute: number): Entry {
	return { runId, kind: 'tool.completed', payload: { toolCallId, output }, at: at(minute) };
}

function ended(runId: string, minute: number): Entry {
	return { runId, kind: 'run.completed', payload: {}, at: at(minute) };
}

function failed(runId: string, payload: object, minute: number): Entry {
	return { runId, kind: 'run.failed', payload, at: at(minute) };
}

function brief(entries: readonly BriefEvent[], decisions: readonly LeadDecision[] = []): string {
	const text = leadBrief(entries, decisions, named);
	if (text === null) throw new Error('expected a brief');
	return text;
}

function entries(text: string): string[] {
	return text.split('\n').filter((line) => line.startsWith('['));
}

function inOrder(text: string, ...parts: string[]): void {
	const positions = parts.map((part) => text.indexOf(part));
	expect(positions.every((position) => position >= 0)).toBe(true);
	expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

function decision(
	fields: Partial<LeadDecision> & Pick<LeadDecision, 'id' | 'topic' | 'askedAt'>,
): LeadDecision {
	return {
		sessionId: 'lead-chat',
		workstreamId: 'lead',
		question: `Which ${fields.topic.toLowerCase()}?`,
		why: null,
		options: [
			{ label: 'Svelte', note: null, picture: null },
			{ label: 'React', note: null, picture: null },
		],
		recommended: 0,
		meanwhile: null,
		answer: null,
		...fields,
	};
}

describe('leadBrief', () => {
	it('has nothing to say for a chat without visible history or open decisions', () => {
		expect(leadBrief([], [], named)).toBeNull();
		expect(
			leadBrief(
				events(
					user('run-1', CONTINUE_AFTER_PAUSE_PROMPT, 0),
					failed('run-1', { error: 'cancelled' }, 1),
				),
				[],
				named,
			),
		).toBeNull();
	});

	it("tells the user's prompts, the Malini calls and the last thing the lead said in each run", () => {
		const text = brief(
			events(
				user('run-1', 'Move the apps to Logdash', 0),
				said('run-1', 'Let me look around.', 1),
				started('run-1', 'Read', 'read-1', { file_path: 'README.md' }, 1),
				completed('run-1', 'read-1', 'file text', 1),
				said('run-1', 'I will start the API work.', 2),
				started(
					'run-1',
					'mcp__malini__workstreams_create',
					'create-1',
					{ repository: 'acme/api', prompt: 'Add   the\nanalytics endpoint' },
					2,
				),
				completed(
					'run-1',
					'create-1',
					JSON.stringify({ id: 'ws-api', name: 'Api analytics', repository: 'acme/api' }),
					3,
				),
				said('run-1', 'Started the API work.', 4),
				ended('run-1', 4),
			),
		);

		expect(text.startsWith('<malini_timeline>\n')).toBe(true);
		expect(text.endsWith('\n</malini_timeline>')).toBe(true);
		inOrder(
			text,
			'The user: Move the apps to Logdash',
			'You started “Api analytics” in acme/api (`ws-api`): Add the analytics endpoint',
			'You replied: Started the API work.',
		);
		expect(text).not.toContain('Let me look around.');
		expect(text).not.toContain('I will start the API work.');
		expect(text).not.toContain('README');
		expect(entries(text)).toHaveLength(3);
	});

	it('writes one line per Malini call it knows and none for the rest', () => {
		const text = brief(
			events(
				user('run-1', 'Keep going', 0),
				said('run-1', 'Sending it now.', 1),
				started(
					'run-1',
					'mcp__malini__workstreams_send',
					'send-1',
					{ workstream: 'ws-api', prompt: 'Use the EU region' },
					1,
				),
				completed('run-1', 'send-1', { id: 'ws-api', name: 'Api analytics' }, 1),
				started(
					'run-1',
					'mcp__malini__workstreams_archive',
					'archive-1',
					{ workstream: 'Site analytics' },
					2,
				),
				completed('run-1', 'archive-1', '{"id":"ws-site","name":"Site analytics"}', 2),
				started(
					'run-1',
					'mcp__malini__jobs_run',
					'job-1',
					{ job: 'update docs', workstream: 'Api analytics' },
					3,
				),
				completed('run-1', 'job-1', '{"id":"job-run-1","job":"Update docs"}', 3),
				started('run-1', 'mcp__malini__jobs_run', 'job-2', { job: 'Lint' }, 4),
				completed('run-1', 'job-2', 'not json', 4),
				started('run-1', 'mcp__malini__plan_write', 'plan-1', { text: '# Plan' }, 5),
				completed('run-1', 'plan-1', '{"path":"/lead/.context/plan.md"}', 5),
				started('run-1', 'mcp__malini__workstreams_list', 'list-1', {}, 6),
				completed('run-1', 'list-1', '[]', 6),
				started(
					'run-1',
					'mcp__github__workstreams_send',
					'github-1',
					{ workstream: 'Elsewhere', prompt: 'Not a Malini call' },
					6,
				),
				completed('run-1', 'github-1', '{"name":"Elsewhere"}', 6),
				started(
					'run-1',
					'mcp__malini__workstreams_send',
					'send-2',
					{ workstream: 'ws-api', prompt: 'p'.repeat(500) },
					7,
				),
				completed('run-1', 'send-2', null, 7),
				completed('run-1', 'never-started', '{"name":"Ghost"}', 8),
				ended('run-1', 8),
			),
		);

		inOrder(
			text,
			'The user: Keep going',
			'You sent “Api analytics”: Use the EU region',
			'You archived “Site analytics”.',
			'You ran Update docs in “Api analytics”.',
			'You ran Lint.',
			'You rewrote your plan.',
			`You sent “ws-api”: ${'p'.repeat(400)}…`,
		);
		expect(text).not.toContain('Ghost');
		expect(text).not.toContain('Elsewhere');
		expect(text).not.toContain('Sending it now.');
		expect(entries(text)).toHaveLength(7);
	});

	it('folds the reports of finished turns into lines and skips decision answers and continuations', () => {
		const text = brief(
			events(
				user('run-1', 'Ship both', 0),
				user('run-2', 'Malini woke you: work you started moved on.', 10, {
					reports: [
						{
							workstreamId: 'ws-api',
							runId: 'api-turn',
							status: 'succeeded',
							outcome: 'Added the endpoint',
							needs: null,
							media: [],
						},
						{
							workstreamId: 'ws-gone',
							runId: 'gone-turn',
							status: 'failed',
							outcome: null,
							needs: 'Which project?',
							media: [],
						},
					],
				}),
				user('run-3', 'Decided “Stack”: Svelte.', 20, { decisions: ['decision-1'] }),
				user('run-4', CONTINUE_AFTER_PAUSE_PROMPT, 30),
				user('run-5', CONTINUE_AFTER_STOP_PROMPT, 40),
				user('run-6', '   ', 50),
			),
		);

		expect(text).toContain(
			'] “Api analytics” finished a turn. Outcome: Added the endpoint. Needs: nothing.\n“A workstream” failed its turn. Outcome: none. Needs: Which project?.',
		);
		expect(text).not.toContain('Malini woke you');
		expect(text).not.toContain('Decided “Stack”');
		expect(text).not.toContain(CONTINUE_AFTER_PAUSE_PROMPT);
		expect(text).not.toContain(CONTINUE_AFTER_STOP_PROMPT);
		expect(entries(text)).toHaveLength(2);
	});

	it('says where a turn paused or failed, after what the lead said in it, and keeps quiet about a stop', () => {
		const text = brief(
			events(
				user('run-1', 'Go', 0),
				said('run-1', 'Halfway there.', 1),
				failed(
					'run-1',
					{ error: 'stopped on usage-limit', resumeAt: '2026-10-28T15:00:00.000Z' },
					2,
				),
				user('run-2', 'Again', 3),
				failed('run-2', { error: 'cancelled' }, 4),
				user('run-3', 'Once more', 5),
				failed('run-3', { error: PAUSED_FOR_EXIT_ERROR }, 6),
				user('run-4', 'Last try', 7),
				said('run-4', 'Trying.', 8),
				failed('run-4', { error: 'Claude Code exited with code 1' }, 9),
				user('run-5', 'Still there?', 10),
				said('run-5', 'Working on it.', 11),
			),
		);

		inOrder(
			text,
			'You replied: Halfway there.',
			'Your turn paused: stopped on usage-limit',
			'The user: Again',
			'The user: Once more',
			'You replied: Trying.',
			'Your turn failed: Claude Code exited with code 1',
			'The user: Still there?',
			'You replied: Working on it.',
		);
		expect(text).not.toContain('cancelled');
		expect(text).not.toContain(PAUSED_FOR_EXIT_ERROR);
	});

	it('weaves the decisions in by time and lists the open ones at the end', () => {
		const text = brief(events(user('run-1', 'Plan the stack', 0)), [
			decision({
				id: 'd-stack',
				topic: 'Stack',
				askedAt: at(1),
				answer: { option: 1, by: 'you', reason: 'The team knows it', at: at(5) },
			}),
			decision({
				id: 'd-region',
				topic: 'Region',
				askedAt: at(2),
				options: [
					{ label: 'EU', note: null, picture: null },
					{ label: 'US', note: null, picture: null },
				],
				recommended: 1,
			}),
			decision({
				id: 'd-logs',
				topic: 'Logs',
				askedAt: at(3),
				answer: { option: 0, by: 'lead', reason: null, at: at(3) },
			}),
			decision({
				id: 'd-database',
				topic: 'Database',
				askedAt: at(4),
				answer: { option: 7, by: 'lead', reason: null, at: at(6) },
			}),
		]);

		inOrder(
			text,
			'The user: Plan the stack',
			'You asked the user “Stack” (`d-stack`): Which stack?',
			'You asked the user “Region” (`d-region`): Which region?',
			'You decided “Logs” yourself: Svelte.',
			'You asked the user “Database” (`d-database`): Which database?',
			'The user decided “Stack”: React. Why: The team knows it',
			'You, from the user’s message, decided “Database”: option 8.',
		);
		expect(text).not.toContain('You asked the user “Logs”');
		expect(
			text.endsWith(
				'\n\nDecisions waiting for the user:\n- “Region” (`d-region`): Which region? 1. EU, 2. US (you recommend it).\n</malini_timeline>',
			),
		).toBe(true);
		expect(
			leadBrief([], [decision({ id: 'd-open', topic: 'Open', askedAt: at(0) })], named),
		).toContain('Decisions waiting for the user:\n- “Open” (`d-open`)');
	});

	it('stamps the day on the first line of each day and only the time on the rest', () => {
		const text = brief(
			events(user('run-1', 'one', 0), said('run-1', 'two', 5), ended('run-1', 5), {
				runId: 'run-2',
				kind: 'user.message',
				payload: { text: 'three' },
				at: at(0, 29),
			}),
		);

		expect(text).toMatch(/^\[\w{3} \d{1,2} \w{3} \d{2}:\d{2}\] The user: one$/mu);
		expect(text).toMatch(/^\[\d{2}:\d{2}\] You replied: two$/mu);
		expect(text).toMatch(/^\[\w{3} \d{1,2} \w{3} \d{2}:\d{2}\] The user: three$/mu);
	});

	it('keeps the first line and the newest ones within its budget', () => {
		const many = Array.from({ length: 400 }, (_, index): Entry => ({
			runId: `run-${index}`,
			kind: 'user.message',
			payload: { text: `Prompt ${index} ${'x'.repeat(400)}` },
			at: new Date(Date.UTC(2026, 9, 28, 0, index)).toISOString(),
		}));
		const text = brief(events(...many));

		inOrder(text, 'The user: Prompt 0 ', 'earlier entries left out]', 'The user: Prompt 399 ');
		expect(text).toMatch(/\n\[\d+ earlier entries left out\]\n/u);
		expect(text).not.toContain('The user: Prompt 1 ');
		expect(text.length).toBeLessThan(125_000);
		expect(text.length).toBeGreaterThan(110_000);
	});
});
