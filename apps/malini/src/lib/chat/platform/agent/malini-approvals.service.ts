import type { MaliniEditReview } from '$contract/approvals';
import type { AutomationDefinitionRecord } from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord } from '$main/db/rows';
import type { CommandOutcome } from '$main/ipc/registry';
import {
	automationDefinitions,
	recordAgentAction,
	type AgentActionContext,
} from '$lib/automations/automations.platform';
import { listWorkstreams } from '$shared/repositories/repositories.platform';
import { descendantWorkstreamIds } from '../../domain/child-requests';
import { getInteraction } from '../interactions.repository';
import { hasActivePermissionRule } from '../permissions.repository';
import {
	MALINI_TOOL_PREFIX,
	maliniActionFingerprint,
	maliniActionPermission,
	type MaliniActionPermission,
} from '../permissions.service';
import type { BridgeEvent } from './protocol';

export type MaliniApproval = Readonly<{
	permission: MaliniActionPermission | null;
	review: MaliniEditReview | null;
}>;

const ASK: MaliniApproval = { permission: null, review: null };

export function withMaliniApproval(db: MaliniDatabase, event: BridgeEvent): BridgeEvent {
	if (event.type !== 'approval.requested') return event;
	const approval = safely(() => assessMaliniApproval(db, event.toolName, event.input));
	if (approval === null) return event;
	const request = { ...event };
	delete request.permission;
	return {
		...request,
		...(approval.permission ? { permission: approval.permission } : {}),
		...(approval.review ? { review: approval.review } : {}),
	};
}

export function assessMaliniApproval(
	db: MaliniDatabase,
	toolName: string | undefined,
	input: unknown,
): MaliniApproval | null {
	if (!toolName?.startsWith(MALINI_TOOL_PREFIX)) return null;
	const field = (key: string): string | undefined => {
		const value: unknown = typeof input === 'object' && input ? Reflect.get(input, key) : null;
		return typeof value === 'string' ? value : undefined;
	};
	const id = field('id');
	switch (toolName.slice(MALINI_TOOL_PREFIX.length)) {
		case 'repositories_clone':
			return grant('repositories.clone');
		case 'repositories_hide':
			return grant('repositories.hide');
		case 'workstreams_create':
			return grant('workstreams.create');
		case 'workstreams_send':
			return grant('workstreams.send');
		case 'workstreams_archive':
			return grant('workstreams.archive');
		case 'automations_run': {
			const [automation, ...others] = automationsNamed(
				automationDefinitions(db),
				field('automation') ?? '',
			);
			return automation && others.length === 0 ? grant(`automations.run:${automation.id}`) : ASK;
		}
		case 'automations_save': {
			if (id === undefined) return grant('automations.save');
			const definitions = automationDefinitions(db);
			const automation = definitions.find((definition) => definition.id === id);
			if (!automation) return ASK;
			return runsWithoutAsking(db, definitions, automation)
				? { permission: null, review: { kind: 'automation', current: automation } }
				: grant('automations.save');
		}
		default:
			return ASK;
	}
}

export function allowedInTree(
	db: MaliniDatabase,
	toolName: string | undefined,
	input: unknown,
	callerWorkstreamId: string,
): boolean {
	if (!toolName?.startsWith(MALINI_TOOL_PREFIX)) return false;
	const field = (key: string): string | undefined => {
		const value: unknown = typeof input === 'object' && input ? Reflect.get(input, key) : null;
		return typeof value === 'string' ? value : undefined;
	};
	const open = listWorkstreams(db);
	const tree = descendantWorkstreamIds(callerWorkstreamId, open);
	const target = (reference: string | undefined): string | null => {
		if (reference === undefined) return null;
		const wanted = reference.trim().toLocaleLowerCase();
		const named = open.filter(
			(workstream) => workstream.id === reference || workstream.name.toLocaleLowerCase() === wanted,
		);
		return named.length === 1 ? (named[0]?.id ?? null) : null;
	};
	switch (toolName.slice(MALINI_TOOL_PREFIX.length)) {
		case 'workstreams_archive': {
			const archived = target(field('workstream'));
			return archived !== null && tree.has(archived);
		}
		case 'automations_run': {
			const definitions = automationDefinitions(db);
			const [automation, ...others] = automationsNamed(definitions, field('automation') ?? '');
			if (!automation || others.length > 0 || shipsWork(definitions, automation)) return false;
			const runsIn =
				field('workstream') === undefined ? callerWorkstreamId : target(field('workstream'));
			return runsIn === callerWorkstreamId || (runsIn !== null && tree.has(runsIn));
		}
		default:
			return false;
	}
}

function shipsWork(
	definitions: readonly AutomationDefinitionRecord[],
	automation: AutomationDefinitionRecord,
	visited = new Set<string>(),
): boolean {
	if (automation.builtin === 'open-draft' || automation.builtin === 'merge') return true;
	if (automation.thenAutomationId === null || visited.has(automation.id)) return false;
	visited.add(automation.id);
	const next = definitions.find((definition) => definition.id === automation.thenAutomationId);
	return next !== undefined && shipsWork(definitions, next, visited);
}

export function automationsNamed(
	definitions: readonly AutomationDefinitionRecord[],
	reference: string,
): AutomationDefinitionRecord[] {
	const byId = definitions.find((definition) => definition.id === reference);
	if (byId) return [byId];
	const wanted = reference.trim().toLocaleLowerCase();
	return definitions.filter((definition) => definition.name.toLocaleLowerCase() === wanted);
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
	'automations.save': 'Save automations',
	'repositories.clone': 'Clone repositories',
	'repositories.hide': 'Hide repositories',
	'workstreams.create': 'Start workstreams',
	'workstreams.send': 'Send prompts to started workstreams',
	'workstreams.archive': 'Archive workstreams',
};

export function maliniActionLabel(db: MaliniDatabase, action: string): string {
	const label = ACTION_LABELS[action];
	if (label) return label;
	const automationId = action.slice('automations.run:'.length);
	const automation = automationDefinitions(db).find((definition) => definition.id === automationId);
	return `Run ‘${automation?.name ?? automationId}’`;
}

export function recordDeniedMaliniCall(context: AgentActionContext, outcome: CommandOutcome): void {
	if (!outcome.ok || outcome.command !== 'chat.decide-approval') return;
	const { args } = outcome;
	if (!isRecord(args) || args['decision'] !== 'deny') return;
	const { sessionId, runId, approvalId } = args;
	if (
		typeof sessionId !== 'string' ||
		typeof runId !== 'string' ||
		typeof approvalId !== 'string'
	) {
		return;
	}
	const record = getInteraction(context.db, 'approval', sessionId, runId, approvalId);
	const request = record?.requestPayload;
	if (!record || !isRecord(request)) return;
	const { toolName, input } = request;
	if (typeof toolName !== 'string' || !toolName.startsWith(MALINI_TOOL_PREFIX)) return;
	recordAgentAction(context, {
		sessionId,
		runId,
		workstreamId: record.workstreamId,
		tool: toolName.slice(MALINI_TOOL_PREFIX.length),
		input: isRecord(input) ? input : {},
		status: 'denied',
		approval: 'denied',
		output: null,
	});
}

function runsWithoutAsking(
	db: MaliniDatabase,
	definitions: readonly AutomationDefinitionRecord[],
	automation: AutomationDefinitionRecord,
	visited = new Set<string>(),
): boolean {
	if (visited.has(automation.id)) return false;
	visited.add(automation.id);
	return (
		automation.builtin !== null ||
		hasActivePermissionRule(db, maliniActionFingerprint(`automations.run:${automation.id}`)) ||
		(automation.trigger !== null && automation.trigger.mode !== 'off') ||
		definitions.some(
			(before) =>
				before.thenAutomationId === automation.id &&
				runsWithoutAsking(db, definitions, before, visited),
		)
	);
}

function safely(assess: () => MaliniApproval | null): MaliniApproval | null {
	try {
		return assess();
	} catch {
		return ASK;
	}
}

function grant(action: string): MaliniApproval {
	return { permission: maliniActionPermission(action), review: null };
}
