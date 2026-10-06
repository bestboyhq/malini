import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import type { RoutinesPlatform } from '../routines.platform';
import { defineRoutineCommands, emitSuggested } from './commands';
import {
	createTokenSetClusterer,
	type RoutinePromptClusterer,
	type TokenSetClustererOptions,
} from './prompt-clustering.service';
import { evaluatePromptLog } from './suggestions.service';

export interface RoutinesOptions {
	readonly clusterer?: RoutinePromptClusterer;
	readonly clustering?: TokenSetClustererOptions;
	readonly log?: (line: string) => void;
}

export function registerRoutines(
	context: MainContext,
	options: RoutinesOptions = {},
): RoutinesPlatform {
	const { db, commands, events } = context;
	const log = options.log ?? ((line: string) => console.error(line));
	const clusterer = options.clusterer ?? createTokenSetClusterer(options.clustering ?? {});

	defineRoutineCommands(commands, { db, events });

	const unsubscribe = events.subscribe(CHAT_AGENT_EVENT_CHANNEL, (payload) => {
		if (!isPromptSubmitted(payload)) return;
		try {
			for (const suggestion of evaluatePromptLog(db, clusterer)) {
				emitSuggested(events, suggestion);
			}
		} catch (error) {
			log(`routines: prompt evaluation failed: ${describe(error)}`);
		}
	});

	return { dispose: unsubscribe };
}

function isPromptSubmitted(payload: unknown): boolean {
	if (!isRecord(payload)) return false;
	const event = payload['event'];
	if (!isRecord(event) || event['type'] !== 'user.message') return false;
	const sessionId = payload['sessionId'];
	return typeof sessionId === 'string' && sessionId.length > 0;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
