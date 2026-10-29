import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_LEAD_DECISION_CHANGED_CHANNEL } from '$contract/events';
import type { LeadDecision } from '$contract/leads';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { isRecord } from '$main/db/rows';
import { createEventBus, type EventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { ChatDeliveries } from './deliveries.service';
import { listLeadDecisions } from './lead-decisions.repository';
import {
	askLeadDecision,
	installLeadDecisions,
	recordLeadDecisionAnswer,
	writeLeadPlan,
} from './lead-decisions.service';
import { insertSession } from './sessions.repository';

const NOW = '2026-10-28T09:00:00.000Z';

const PICTURE_OUTSIDE =
	'`picture` must be a file inside the checkout of a workstream this chat started, such as one its report embeds.';

let root: string;
let db: MaliniDatabase;
let events: EventBus;
let commands: CommandRegistry;
let deliveries: ChatDeliveries;
let sent: Array<Record<string, unknown>>;
let emitted: LeadDecision[];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'malini-lead-decisions-'));
	db = openMigratedDatabase(':memory:');
	events = createEventBus({ forwardToWindows: false });
	commands = new CommandRegistry();
	sent = [];
	emitted = [];
	commands.define('chat.send-prompt', (args: unknown) => {
		if (!isRecord(args)) throw new Error('chat.send-prompt takes an object');
		sent.push(args);
		return `delivered-run-${sent.length}`;
	});
	events.subscribe(CHAT_LEAD_DECISION_CHANGED_CHANNEL, ({ decision }) => {
		emitted.push(decision);
	});
	seed();
	deliveries = new ChatDeliveries({ db, commands, events }, () => {});
	installLeadDecisions({ db, events, commands }, deliveries);
});

afterEach(() => {
	deliveries.stop();
	db.close();
	rmSync(root, { recursive: true, force: true });
});

function seed(): void {
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: join(root, 'project'),
		defaultBranch: 'main',
		createdAt: NOW,
	});
	workstream('lead', null, 'home');
	workstream('api', 'lead');
	workstream('grand', 'api');
	workstream('other', null);
	chat('lead-chat', 'lead');
	chat('api-chat', 'api');
	for (const file of ['api/shots/a.png', 'lead/notes/b.png', 'grand/c.png', 'other/d.png']) {
		picture(file);
	}
	picture('loose.png');
}

function workstream(id: string, startedBy: string | null, scope: string | null = null): void {
	upsertWorkstream(db, {
		id,
		projectId: 'project',
		name: id,
		path: join(root, id),
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		scope,
		startedBy,
	});
}

function chat(id: string, workstreamId: string): void {
	insertSession(db, {
		id,
		workstreamId,
		model: null,
		providerSessionId: null,
		status: 'idle',
		startedAt: NOW,
	});
}

function picture(file: string): void {
	const path = join(root, file);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, 'png');
}

const context = (): Readonly<{ db: MaliniDatabase; events: EventBus }> => ({ db, events });

const stack = {
	topic: 'Stack',
	question: 'Which stack?',
	options: [{ label: 'Svelte' }, { label: 'React' }],
	recommended: 1,
};

function asked(input: Readonly<Record<string, unknown>> = stack): string {
	const id = askLeadDecision(context(), 'lead-chat', input)['id'];
	if (typeof id !== 'string') throw new Error('decisions_ask returned no id');
	return id;
}

async function failure(command: string, args: unknown): Promise<string> {
	const response = await commands.invoke({ command, args });
	if (response.ok) throw new Error(`expected ${command} to fail`);
	return response.error;
}

describe('askLeadDecision', () => {
	it('keeps the question, its options and their pictures, and shows it to the user', async () => {
		const result = askLeadDecision(context(), 'lead-chat', {
			topic: ' Chart style ',
			question: 'Which chart reads best?',
			why: 'Both work for the dashboard',
			options: [
				{ label: 'Bars', note: 'Simple', picture: join(root, 'api/shots/a.png') },
				{ label: 'Lines', picture: 'notes/b.png' },
				{ label: 'Area', picture: join(realpathSync(root), 'grand/c.png') },
			],
			recommended: 2,
			meanwhile: 'I keep building the API',
		});

		expect(result).toEqual({
			id: expect.any(String),
			topic: 'Chart style',
			status: 'waiting for the user',
		});
		const listed = await commands.call('chat.list-lead-decisions', { sessionId: 'lead-chat' });
		expect(listed).toEqual([
			{
				id: result['id'],
				sessionId: 'lead-chat',
				workstreamId: 'lead',
				topic: 'Chart style',
				question: 'Which chart reads best?',
				why: 'Both work for the dashboard',
				options: [
					{ label: 'Bars', note: 'Simple', picture: { workstreamId: 'api', path: 'shots/a.png' } },
					{ label: 'Lines', note: null, picture: { workstreamId: 'lead', path: 'notes/b.png' } },
					{ label: 'Area', note: null, picture: { workstreamId: 'grand', path: 'c.png' } },
				],
				recommended: 1,
				meanwhile: 'I keep building the API',
				askedAt: expect.any(String),
				answer: null,
			},
		]);
		expect(emitted).toEqual(listed);
	});

	it('records a decision the lead took itself as answered with its pick when it was asked', () => {
		const result = askLeadDecision(context(), 'lead-chat', {
			topic: 'Logs',
			question: 'Where do the logs go?',
			options: [{ label: 'Logdash' }, { label: 'Sentry' }],
			recommended: 1,
			decided: true,
		});

		expect(result).toMatchObject({ topic: 'Logs', status: 'decided' });
		const [saved] = listLeadDecisions(db, 'lead-chat');
		expect(saved?.answer).toEqual({ option: 0, by: 'lead', reason: null, at: saved?.askedAt });
		expect(emitted).toEqual([saved]);
		expect(sent).toEqual([]);
	});

	it('refuses a chat that is no lead, and options it cannot show', () => {
		const ask = (sessionId: string, input: Readonly<Record<string, unknown>>) => () =>
			askLeadDecision(context(), sessionId, { ...stack, ...input });
		const pictured = (picture: string) => ({
			options: [{ label: 'Svelte', picture }, { label: 'React' }],
		});

		expect(ask('api-chat', {})).toThrow(
			'Only a chat at Home or in an organization keeps decisions and a plan.',
		);
		expect(ask('missing-chat', {})).toThrow('Only a chat at Home or in an organization');
		expect(ask('lead-chat', { options: [{ label: 'Svelte' }] })).toThrow(
			'`options` must hold two to four options.',
		);
		expect(
			ask('lead-chat', {
				options: Array.from({ length: 5 }, (_, index) => ({ label: `Option ${index}` })),
			}),
		).toThrow('`options` must hold two to four options.');
		expect(ask('lead-chat', { options: 'Svelte or React' })).toThrow(
			'`options` must hold two to four options.',
		);
		expect(ask('lead-chat', { recommended: 0 })).toThrow(
			'The option must be a number from 1 to 2.',
		);
		expect(ask('lead-chat', { recommended: 3 })).toThrow(
			'The option must be a number from 1 to 2.',
		);
		expect(ask('lead-chat', { recommended: 1.5 })).toThrow(
			'The option must be a number from 1 to 2.',
		);
		expect(ask('lead-chat', { topic: '  ' })).toThrow('`topic` is required.');
		expect(ask('lead-chat', { why: 5 })).toThrow('`why` must be a string.');
		expect(ask('lead-chat', { options: [{ label: 'Svelte' }, { note: 'No label' }] })).toThrow(
			'`label` is required.',
		);
		expect(ask('lead-chat', pictured('nope.png'))).toThrow('`picture` names no file: nope.png');
		expect(ask('lead-chat', pictured(join(root, 'other/d.png')))).toThrow(PICTURE_OUTSIDE);
		expect(ask('lead-chat', pictured('../other/d.png'))).toThrow(PICTURE_OUTSIDE);
		expect(ask('lead-chat', pictured(join(root, 'loose.png')))).toThrow(PICTURE_OUTSIDE);

		expect(listLeadDecisions(db, 'lead-chat')).toEqual([]);
		expect(emitted).toEqual([]);
	});
});

describe('recordLeadDecisionAnswer', () => {
	it('records the answer the user gave in the chat, by its number', () => {
		const id = asked();

		expect(
			recordLeadDecisionAnswer(context(), 'lead-chat', {
				decision: id,
				option: 2,
				reason: ' The team knows it ',
			}),
		).toEqual({ id, topic: 'Stack', decided: 'React' });
		expect(listLeadDecisions(db, 'lead-chat')[0]?.answer).toEqual({
			option: 1,
			by: 'you',
			reason: 'The team knows it',
			at: expect.any(String),
		});
		expect(emitted.map((decision) => decision.answer?.option ?? null)).toEqual([null, 1]);
		expect(sent).toEqual([]);
	});

	it('refuses a decision of another chat and an option the decision lacks', () => {
		const id = asked();

		expect(() =>
			recordLeadDecisionAnswer(context(), 'api-chat', { decision: id, option: 1 }),
		).toThrow('No decision of this chat has that id. Pass the id decisions_ask returned.');
		expect(() =>
			recordLeadDecisionAnswer(context(), 'lead-chat', { decision: 'nope', option: 1 }),
		).toThrow('No decision of this chat has that id.');
		expect(() =>
			recordLeadDecisionAnswer(context(), 'lead-chat', { decision: id, option: 3 }),
		).toThrow('The option must be a number from 1 to 2.');
		expect(listLeadDecisions(db, 'lead-chat')[0]?.answer).toBeNull();
	});
});

describe('writeLeadPlan', () => {
	it("writes the plan into the lead's checkout", async () => {
		const path = join(root, 'lead', '.context', 'plan.md');

		expect(
			await writeLeadPlan(context(), 'lead-chat', { text: '# Plan\n\n- Ship the API\n\n\n' }),
		).toEqual({ path });
		expect(readFileSync(path, 'utf8')).toBe('# Plan\n\n- Ship the API\n');

		await writeLeadPlan(context(), 'lead-chat', { text: '# Plan\n\n- Ship the site' });
		expect(readFileSync(path, 'utf8')).toBe('# Plan\n\n- Ship the site\n');
	});

	it('refuses a chat that is no lead and an empty plan', async () => {
		await expect(writeLeadPlan(context(), 'api-chat', { text: '# Plan' })).rejects.toThrow(
			'Only a chat at Home or in an organization keeps decisions and a plan.',
		);
		await expect(writeLeadPlan(context(), 'lead-chat', { text: ' ' })).rejects.toThrow(
			'`text` is required.',
		);
	});
});

describe('chat.answer-lead-decision', () => {
	const chart = {
		topic: 'Chart style',
		question: 'Which chart?',
		options: [{ label: 'Bars' }, { label: 'Lines' }, { label: 'Area' }],
		recommended: 1,
	};

	it('saves what the user picked and tells the lead chat', async () => {
		const id = asked(chart);

		const answered = await commands.call('chat.answer-lead-decision', {
			decisionId: id,
			option: 1,
		});

		expect(answered.answer).toEqual({ option: 1, by: 'you', reason: null, at: expect.any(String) });
		expect(listLeadDecisions(db, 'lead-chat')).toEqual([answered]);
		expect(emitted.at(-1)).toEqual(answered);
		expect(sent).toEqual([
			{
				sessionId: 'lead-chat',
				prompt: 'Decided “Chart style”: Lines.',
				automated: false,
				decisions: [id],
			},
		]);
	});

	it('sends nothing for the same answer again, the reason with a new one, and both picks for a change', async () => {
		const id = asked(chart);
		const answered = await commands.call('chat.answer-lead-decision', {
			decisionId: id,
			option: 1,
		});

		expect(await commands.call('chat.answer-lead-decision', { decisionId: id, option: 1 })).toEqual(
			answered,
		);
		expect(sent).toHaveLength(1);

		await commands.call('chat.answer-lead-decision', {
			decisionId: id,
			option: 1,
			reason: 'Easier to read',
		});
		await commands.call('chat.answer-lead-decision', { decisionId: id, option: 2 });

		expect(sent.map((args) => args['prompt'])).toEqual([
			'Decided “Chart style”: Lines.',
			'Decided “Chart style”: Lines.\nWhy: Easier to read',
			'Changed “Chart style” to Area, from Lines.',
		]);
	});

	it('answers a decision the lead took itself as the user’s own', async () => {
		const id = asked({ ...stack, decided: true });

		await commands.call('chat.answer-lead-decision', { decisionId: id, option: 0 });
		await commands.call('chat.answer-lead-decision', { decisionId: id, option: 1 });

		expect(sent.map((args) => args['prompt'])).toEqual([
			'Decided “Stack”: Svelte.',
			'Changed “Stack” to React, from Svelte.',
		]);
		expect(listLeadDecisions(db, 'lead-chat')[0]?.answer).toMatchObject({ option: 1, by: 'you' });
	});

	it('refuses a decision that is gone and an option it lacks', async () => {
		const id = asked();

		expect(await failure('chat.answer-lead-decision', { decisionId: 'nope', option: 0 })).toBe(
			'That decision no longer exists.',
		);
		expect(await failure('chat.answer-lead-decision', { decisionId: id, option: 2 })).toBe(
			'The option must be a number from 0 to 1.',
		);
		expect(await failure('chat.answer-lead-decision', { decisionId: id, option: -1 })).toBe(
			'The option must be a number from 0 to 1.',
		);
		expect(sent).toEqual([]);
		expect(listLeadDecisions(db, 'lead-chat')[0]?.answer).toBeNull();
	});
});

describe('chat.list-deliveries', () => {
	it('lists what a chat sent, and nothing it received', async () => {
		await deliveries.deliver({
			sessionId: 'api-chat',
			kind: 'prompt',
			prompt: 'Use the EU region.',
			fromSessionId: 'lead-chat',
			fromWorkstreamId: 'lead',
		});
		await deliveries.deliver({
			sessionId: 'lead-chat',
			kind: 'prompt',
			prompt: 'Done.',
			fromSessionId: 'api-chat',
		});

		expect(await commands.call('chat.list-deliveries', { fromSessionId: 'lead-chat' })).toEqual([
			expect.objectContaining({
				sessionId: 'api-chat',
				fromSessionId: 'lead-chat',
				status: 'delivered',
			}),
		]);
		expect(await failure('chat.list-deliveries', {})).toBe('`fromSessionId` is required.');
	});
});
