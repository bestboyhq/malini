import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { CHAT_LEAD_DECISION_CHANGED_CHANNEL } from '$contract/events';
import type { LeadDecision, LeadDecisionOption, LeadDecisionPicture } from '$contract/leads';
import type { Workstream } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import {
	getWorkstream,
	leadPlanPath,
	listWorkstreams,
} from '$shared/repositories/repositories.platform';
import { descendantWorkstreamIds } from '../domain/child-requests';
import { persistedBridgeSession } from './agent/sessions';
import type { ChatDeliveries } from './deliveries.service';
import { deliveriesFrom } from './deliveries.repository';
import {
	answerLeadDecision,
	getLeadDecision,
	insertLeadDecision,
	listLeadDecisions,
} from './lead-decisions.repository';

type Input = Readonly<Record<string, unknown>>;

type LeadContext = Pick<MainContext, 'db' | 'events'>;

const MAX_OPTIONS = 4;

export function installLeadDecisions(
	context: Pick<MainContext, 'db' | 'events' | 'commands'>,
	deliveries: ChatDeliveries,
): void {
	const { db, commands } = context;
	commands.define('chat.list-lead-decisions', (args: unknown) =>
		listLeadDecisions(db, requiredText(record(args), 'sessionId')),
	);
	commands.define('chat.list-deliveries', (args: unknown) =>
		deliveriesFrom(db, requiredText(record(args), 'fromSessionId')),
	);
	commands.define('chat.answer-lead-decision', async (args: unknown) => {
		const input = record(args);
		const decision = getLeadDecision(db, requiredText(input, 'decisionId'));
		if (!decision) throw new Error('That decision no longer exists.');
		const option = optionIndex(decision, input['option'], 0);
		const reason = optionalText(input, 'reason');
		const before = decision.answer;
		if (before?.by === 'you' && before.option === option && before.reason === reason) {
			return decision;
		}
		const answered = answer(context, decision.id, { option, by: 'you', reason });
		const switched = before !== null && before.option !== option ? before.option : null;
		await deliveries.deliver({
			sessionId: decision.sessionId,
			kind: 'decision',
			prompt: decisionPrompt(answered, switched),
			decisionId: decision.id,
		});
		return answered;
	});
}

export function askLeadDecision(
	context: LeadContext,
	sessionId: string,
	input: Input,
): Readonly<Record<string, unknown>> {
	const lead = leadOf(context, sessionId);
	const options = optionList(context, lead, input['options']);
	const askedAt = nowIso8601();
	const decision = {
		id: randomUUID(),
		sessionId,
		topic: requiredText(input, 'topic'),
		question: requiredText(input, 'question'),
		why: optionalText(input, 'why'),
		options,
		recommended: optionIndex({ options }, input['recommended'], 1),
		meanwhile: optionalText(input, 'meanwhile'),
		askedAt,
	};
	insertLeadDecision(context.db, decision);
	const saved =
		input['decided'] === true
			? answer(context, decision.id, {
					option: decision.recommended,
					by: 'lead',
					reason: null,
					at: askedAt,
				})
			: emitted(context, decision.id);
	return {
		id: saved.id,
		topic: saved.topic,
		status: saved.answer ? 'decided' : 'waiting for the user',
	};
}

export function recordLeadDecisionAnswer(
	context: LeadContext,
	sessionId: string,
	input: Input,
): Readonly<Record<string, unknown>> {
	const decision = getLeadDecision(context.db, requiredText(input, 'decision'));
	if (!decision || decision.sessionId !== sessionId) {
		throw new Error('No decision of this chat has that id. Pass the id decisions_ask returned.');
	}
	const saved = answer(context, decision.id, {
		option: optionIndex(decision, input['option'], 1),
		by: 'you',
		reason: optionalText(input, 'reason'),
	});
	return {
		id: saved.id,
		topic: saved.topic,
		decided: saved.options[saved.answer?.option ?? 0]?.label ?? null,
	};
}

export async function writeLeadPlan(
	context: LeadContext,
	sessionId: string,
	input: Input,
): Promise<Readonly<Record<string, unknown>>> {
	const lead = leadOf(context, sessionId);
	const path = leadPlanPath(lead.path);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${requiredText(input, 'text').trimEnd()}\n`);
	return { path };
}

function leadOf({ db }: LeadContext, sessionId: string): Workstream {
	const session = persistedBridgeSession(db, sessionId);
	const workstream = session === null ? null : getWorkstream(db, session.workstreamId);
	if (!workstream || workstream.scope === null) {
		throw new Error(
			'Only a chat at Home or in an organization keeps decisions and a plan. Say what the user must decide in your Needs line instead.',
		);
	}
	return workstream;
}

function answer(
	context: LeadContext,
	id: string,
	given: Readonly<{ option: number; by: 'you' | 'lead'; reason: string | null; at?: string }>,
): LeadDecision {
	const saved = answerLeadDecision(context.db, id, { ...given, at: given.at ?? nowIso8601() });
	if (!saved) throw new Error('That decision no longer exists.');
	return emit(context, saved);
}

function emitted(context: LeadContext, id: string): LeadDecision {
	const saved = getLeadDecision(context.db, id);
	if (!saved) throw new Error('Malini could not record the decision.');
	return emit(context, saved);
}

function emit(context: LeadContext, decision: LeadDecision): LeadDecision {
	context.events.emit(CHAT_LEAD_DECISION_CHANGED_CHANNEL, { decision });
	return decision;
}

export function decisionPrompt(decision: LeadDecision, before: number | null): string {
	const label = (option: number): string => decision.options[option]?.label ?? '?';
	const picked = decision.answer?.option ?? decision.recommended;
	const head =
		before === null
			? `Decided “${decision.topic}”: ${label(picked)}.`
			: `Changed “${decision.topic}” to ${label(picked)}, from ${label(before)}.`;
	const reason = decision.answer?.reason;
	return reason ? `${head}\nWhy: ${reason}` : head;
}

function optionList(context: LeadContext, lead: Workstream, value: unknown): LeadDecisionOption[] {
	if (!Array.isArray(value) || value.length < 2 || value.length > MAX_OPTIONS) {
		throw new Error('`options` must hold two to four options.');
	}
	return value.map((option: unknown) => {
		const item = record(option);
		const picture = optionalText(item, 'picture');
		return {
			label: requiredText(item, 'label'),
			note: optionalText(item, 'note'),
			picture: picture === null ? null : pictureIn(context, lead, picture),
		};
	});
}

function pictureIn({ db }: LeadContext, lead: Workstream, reference: string): LeadDecisionPicture {
	const open = listWorkstreams(db);
	const tree = new Set([lead.id, ...descendantWorkstreamIds(lead.id, open)]);
	const absolute = isAbsolute(reference) ? reference : join(lead.path, reference);
	if (!existsSync(absolute)) throw new Error(`\`picture\` names no file: ${reference}`);
	const real = realpathSync(absolute);
	for (const workstream of open) {
		if (!tree.has(workstream.id)) continue;
		for (const [root, path] of [
			[workstream.path, absolute],
			[realpathOr(workstream.path), real],
		] as const) {
			const inside = relative(root, path);
			if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
				return { workstreamId: workstream.id, path: inside };
			}
		}
	}
	throw new Error(
		'`picture` must be a file inside the checkout of a workstream this chat started, such as one its report embeds.',
	);
}

function optionIndex(
	decision: Readonly<{ options: readonly unknown[] }>,
	value: unknown,
	from: 0 | 1,
): number {
	const index = typeof value === 'number' && Number.isInteger(value) ? value - from : -1;
	if (index < 0 || index >= decision.options.length) {
		throw new Error(
			`The option must be a number from ${from} to ${decision.options.length - 1 + from}.`,
		);
	}
	return index;
}

function realpathOr(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function record(value: unknown): Input {
	return isRecord(value) ? value : {};
}

function requiredText(input: Input, key: string): string {
	const value = optionalText(input, key);
	if (value === null) throw new Error(`\`${key}\` is required.`);
	return value;
}

function optionalText(input: Input, key: string): string | null {
	const value = input[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') throw new Error(`\`${key}\` must be a string.`);
	const text = value.trim();
	return text.length > 0 ? text : null;
}
