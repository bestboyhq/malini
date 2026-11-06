import { randomUUID } from 'node:crypto';
import { mergedInRepositoryWhen } from '$contract/automation-trigger';
import { CHAT_TURN_FINISHED_CHANNEL, AUTOMATIONS_SUGGESTED_CHANNEL } from '$contract/events';
import type { AutomationSuggestedEvent } from '$contract/automations';
import { typedRun } from '$lib/chat/chat.platform';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { AUTOMATION_NAME_MAX_LENGTH } from '../domain/automation-definition';
import {
	insertAskIfFirst,
	insertSuggestion,
	listSuggestedBefore,
	listUnsuggestedAsks,
	type AutomationAsk,
} from './automation-suggestions.repository';
import { latestMergeBetween } from './event-log.repository';
import { runOneShotAutomation, type AnswerWithAutomation } from './one-shot-automations.service';

const AFTER_MERGE_MS = 24 * 60 * 60 * 1_000;

const EARLIER_ASKS = 6;

const ASK_CHARS = 600;

const SUGGESTION_INSTRUCTIONS_CHARS = 600;

export const HABIT_SCHEMA: Readonly<Record<string, unknown>> = {
	type: 'object',
	properties: {
		same: { type: 'array', items: { type: 'integer', minimum: 1 } },
		name: { type: 'string' },
		instructions: { type: 'string' },
	},
	required: ['same', 'name', 'instructions'],
	additionalProperties: false,
};

type Habit = Readonly<{ asks: readonly AutomationAsk[]; name: string; instructions: string }>;

export function suggestAutomationsAfterMerges(
	context: MainContext,
	answer: AnswerWithAutomation,
	log: (line: string) => void,
): () => void {
	return context.events.subscribe(CHAT_TURN_FINISHED_CHANNEL, ({ sessionId, runId, status }) => {
		if (status !== 'succeeded') return;
		void noticeAsk(context, answer, sessionId, runId).catch((error: unknown) => {
			log(`automations: could not look for a habit after \`${runId}\`: ${describeError(error)}`);
		});
	});
}

async function noticeAsk(
	{ db, events }: MainContext,
	answer: AnswerWithAutomation,
	sessionId: string,
	runId: string,
): Promise<void> {
	const typed = typedRun(db, runId);
	if (!typed) return;
	const since = new Date(Date.parse(typed.startedAt) - AFTER_MERGE_MS).toISOString();
	const merge = latestMergeBetween(db, typed.workstreamId, since, typed.startedAt);
	if (!merge) return;
	const ask: AutomationAsk = {
		id: randomUUID(),
		mergeEventId: merge.id,
		repositoryId: typed.repositoryId,
		workstreamId: typed.workstreamId,
		sessionId,
		runId,
		text: typed.text,
		pullRequestNumber: merge.pullRequestNumber,
		askedAt: typed.startedAt,
	};
	if (!insertAskIfFirst(db, ask)) return;
	const earlier = listUnsuggestedAsks(db, ask.repositoryId, ask.id, EARLIER_ASKS).reverse();
	if (earlier.length === 0) return;
	const task = habitTask(ask, earlier, listSuggestedBefore(db, ask.repositoryId));
	const output = await runOneShotAutomation(
		db,
		'suggest-automations',
		task,
		async (text, automation) => JSON.stringify(await answer(text, automation, HABIT_SCHEMA)),
	);
	const habit = habitFrom(output, earlier);
	if (!habit) return;
	const suggestion = insertSuggestion(
		db,
		{
			id: randomUUID(),
			repositoryId: ask.repositoryId,
			sessionId,
			afterRunId: runId,
			name: habit.name,
			instructions: habit.instructions,
			when: mergedInRepositoryWhen(ask.repositoryId),
			createdAt: nowIso8601(),
		},
		[...habit.asks, ask].map(({ id }) => id),
	);
	const suggested: AutomationSuggestedEvent = { suggestion };
	events.emit(AUTOMATIONS_SUGGESTED_CHANNEL, suggested);
}

function habitTask(
	latest: AutomationAsk,
	earlier: readonly AutomationAsk[],
	suggestedBefore: readonly Readonly<{ name: string; instructions: string }>[],
): string {
	return [
		'Earlier asks:',
		...earlier.map((ask, index) => `${index + 1}. ${quotedAsk(ask)}`),
		'',
		`Latest ask: ${quotedAsk(latest)}`,
		...(suggestedBefore.length === 0
			? []
			: [
					'',
					'Suggested before:',
					...suggestedBefore.map(({ name, instructions }) => `- ${name}: ${instructions}`),
				]),
	].join('\n');
}

function quotedAsk({ text, pullRequestNumber }: AutomationAsk): string {
	const merged = pullRequestNumber === null ? 'a pull request' : `#${pullRequestNumber}`;
	return `after ${merged} merged, <ask>${text.slice(0, ASK_CHARS)}</ask>`;
}

function habitFrom(output: string, earlier: readonly AutomationAsk[]): Habit | null {
	const answer: unknown = JSON.parse(output);
	if (!isRecord(answer)) return null;
	const { same, name, instructions } = answer;
	if (!Array.isArray(same) || typeof name !== 'string' || typeof instructions !== 'string') {
		return null;
	}
	const asks = [...new Set(same)].flatMap((number: unknown) => {
		const ask = typeof number === 'number' ? earlier[number - 1] : undefined;
		return ask ? [ask] : [];
	});
	const trimmedName = name.trim();
	const trimmedInstructions = instructions.trim();
	return asks.length > 0 &&
		trimmedName.length > 0 &&
		trimmedName.length <= AUTOMATION_NAME_MAX_LENGTH &&
		trimmedInstructions.length > 0 &&
		trimmedInstructions.length <= SUGGESTION_INSTRUCTIONS_CHARS
		? { asks, name: trimmedName, instructions: trimmedInstructions }
		: null;
}
