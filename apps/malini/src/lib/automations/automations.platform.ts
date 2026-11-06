import {
	DEFAULT_AUTOMATION_BOUNDARY,
	isShippingAutomationBuiltin,
	type AutomationBoundary,
	type AutomationDefinitionRecord,
	type AutomationRunRecord,
} from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import type { DispatchedEvent } from './platform/event-log.service';
import {
	getAutomationDefinition,
	listAutomationDefinitions,
} from './platform/automation-definitions.repository';
import {
	activeWorkstreamAutomationRun,
	findActiveAutomationRunForSession,
	getAutomationRun,
	latestAutomationRunForSession,
	latestWorkstreamAutomationRun,
} from './platform/automation-runs.repository';

export { AUTOMATION_CONTEXT_MAX_BYTES } from './domain/automation-run';
export { clearAlarm, setAlarm } from './platform/alarms.repository';
export { startingSessionId } from './platform/agent-actions.repository';
export { heardBack, latestLoggedEvent } from './platform/event-log.repository';
export { handledEvent, type DispatchedEvent } from './platform/event-log.service';
export {
	finishAgentAction,
	recordAgentAction,
	type AgentActionContext,
	type AgentActionStart,
} from './platform/agent-actions.service';
export {
	runOneShotAutomation,
	type OneShotAutomation,
	type AnswerWithAutomation,
	type ChooseWithAutomation,
	type SuggestWithAutomation,
} from './platform/one-shot-automations.service';

export interface AutomationsPlatform {
	start(): void;
	dispose(): void;
}

export type ShippingDecision = Readonly<{
	move: string;
	act(event: DispatchedEvent): Promise<void>;
}>;

export type ShippingRule = Readonly<{
	hear(event: DispatchedEvent): Promise<readonly string[]>;
	decide(workstreamId: string): Promise<ShippingDecision | null>;
	merging(workstreamId: string): boolean;
}>;

export function automationDefinitions(db: MaliniDatabase): AutomationDefinitionRecord[] {
	return listAutomationDefinitions(db);
}

export function activeAutomationRunForSession(
	db: MaliniDatabase,
	sessionId: string,
): AutomationRunRecord | null {
	return findActiveAutomationRunForSession(db, sessionId);
}

export function automationBoundaryForSession(
	db: MaliniDatabase,
	sessionId: string,
): AutomationBoundary | null {
	const run = latestAutomationRunForSession(db, sessionId);
	return run === null
		? null
		: (getAutomationDefinition(db, run.definitionId)?.boundary ?? DEFAULT_AUTOMATION_BOUNDARY);
}

export function automationDefinition(
	db: MaliniDatabase,
	id: string,
): AutomationDefinitionRecord | null {
	return getAutomationDefinition(db, id);
}

export function automationRun(db: MaliniDatabase, id: string): AutomationRunRecord | null {
	return getAutomationRun(db, id);
}

export function latestShippingAutomationRun(
	db: MaliniDatabase,
	workstreamId: string,
): AutomationRunRecord | null {
	return latestWorkstreamAutomationRun(db, workstreamId, shippingAutomationIds(db));
}

export function activeShippingAutomationRun(
	db: MaliniDatabase,
	workstreamId: string,
): AutomationRunRecord | null {
	return activeWorkstreamAutomationRun(db, workstreamId, shippingAutomationIds(db));
}

function shippingAutomationIds(db: MaliniDatabase): string[] {
	return listAutomationDefinitions(db)
		.filter(({ builtin }) => isShippingAutomationBuiltin(builtin))
		.map(({ id }) => id);
}
