import { randomUUID } from 'node:crypto';
import type { OneShotAutomationBuiltin } from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { DEFAULT_PROVIDER_ID } from '$shared/providers/providers.platform';
import { BUILTIN_AUTOMATIONS } from '../domain/builtin-automations';
import { getBuiltinAutomationDefinition } from './automation-definitions.repository';
import {
	insertAutomationOutput,
	insertAutomationSetup,
	latestAutomationSetup,
} from './automation-outputs.repository';

export const AUTOMATION_OUTPUT_INPUT_MAX_LENGTH = 4_000;

export type OneShotAutomation = Readonly<{ instructions: string; provider: string; model: string }>;

export type SuggestWithAutomation = (
	task: string,
	automation: OneShotAutomation,
) => Promise<string>;

export type ChooseWithAutomation = (
	task: string,
	automation: OneShotAutomation,
	choices: number,
) => Promise<number>;

export type AnswerWithAutomation = (
	task: string,
	automation: OneShotAutomation,
	schema: Readonly<Record<string, unknown>>,
) => Promise<Readonly<Record<string, unknown>>>;

type OutputResult = Readonly<{ output: string; error: null } | { output: null; error: string }>;

export async function runOneShotAutomation(
	db: MaliniDatabase,
	builtin: OneShotAutomationBuiltin,
	task: string,
	suggest: SuggestWithAutomation,
): Promise<string> {
	const definition = getBuiltinAutomationDefinition(db, builtin);
	const defaults = BUILTIN_AUTOMATIONS[builtin];
	const { instructions, model } = definition ?? defaults;
	const provider = definition?.provider ?? DEFAULT_PROVIDER_ID;
	const automation: OneShotAutomation = { instructions, provider, model };
	const record = (result: OutputResult): void => {
		if (definition) recordAutomationOutput(db, definition.id, automation, task, result);
	};
	try {
		const output = await suggest(task, automation);
		record({ output, error: null });
		return output;
	} catch (error) {
		record({ output: null, error: describeError(error) });
		throw error;
	}
}

function recordAutomationOutput(
	db: MaliniDatabase,
	definitionId: string,
	automation: OneShotAutomation,
	task: string,
	result: OutputResult,
): void {
	try {
		db.transaction(() => {
			const createdAt = nowIso8601();
			const latest = latestAutomationSetup(db, definitionId);
			const reused =
				latest !== null &&
				latest.provider === automation.provider &&
				latest.model === automation.model &&
				latest.instructions === automation.instructions
					? latest.id
					: null;
			const setupId = reused ?? randomUUID();
			if (reused === null) {
				insertAutomationSetup(db, definitionId, {
					id: setupId,
					provider: automation.provider,
					model: automation.model,
					instructions: automation.instructions,
					expectedRate: null,
					createdAt,
				});
			}
			insertAutomationOutput(db, {
				id: randomUUID(),
				definitionId,
				setupId,
				input: task.slice(0, AUTOMATION_OUTPUT_INPUT_MAX_LENGTH),
				output: result.output,
				error: result.error,
				createdAt,
			});
		});
	} catch (error) {
		console.error(
			`automations: could not record what ${definitionId} produced: ${describeError(error)}`,
		);
	}
}
