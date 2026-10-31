import type { MaliniDatabase } from '$main/db/driver';
import { listTimelineEventRows } from '../events.repository';
import { userPromptText } from '../fork-transcript';
import { setSessionModel } from '../sessions.repository';
import { all, get, isRecord } from '$main/db/rows';
import { resolveWorkstreamCheckoutCanonical, workstreamCheckoutExists } from '$main/git/paths';
import { claudeModelFor, isValidAgentModel } from '$shared/providers/providers.platform';
import { LifecycleError } from './lifecycle';
import type { AgentConversationMessage, BridgeCommand } from './protocol';
import type { BridgeSupervisor } from './supervisor';

const MAX_RESTORED_CONVERSATION_BYTES = 256 * 1024;
const MAX_RESTORED_CONVERSATION_MESSAGES = 4_096;

export function validateAgentModel(model: string | null | undefined): void {
	if (model === null || model === undefined || isValidAgentModel(model)) return;
	throw new Error(`model \`${model}\` is not in the agent catalog`);
}

export function repairPersistedModel(
	db: MaliniDatabase,
	sessionId: string,
	model: string | null,
): string {
	const repaired = claudeModelFor(model);
	if (repaired !== model) setSessionModel(db, sessionId, repaired);
	return repaired;
}

export function worktreePath(appDataRoot: string, workstreamId: string): string {
	try {
		return resolveWorkstreamCheckoutCanonical(appDataRoot, workstreamId);
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : String(error));
	}
}

export function worktreeExists(appDataRoot: string, workstreamId: string): boolean {
	return workstreamCheckoutExists(appDataRoot, workstreamId);
}

export interface StartSessionInput {
	commandId: string;
	sessionId: string;
	workstreamId: string;
	model: string | null;
	providerSessionId: string | null;
	worktreePath: string | null;
	conversationHistory?: AgentConversationMessage[] | null;
}

export function startSessionCommand(input: StartSessionInput): BridgeCommand {
	try {
		validateAgentModel(input.model);
	} catch (error) {
		throw new LifecycleError('invalid_agent_model', describe(error));
	}
	return {
		cmd: 'start_session',
		id: input.commandId,
		sessionId: input.sessionId,
		workstreamId: input.workstreamId,
		...(input.model === null ? {} : { model: input.model }),
		...(input.providerSessionId === null ? {} : { providerSessionId: input.providerSessionId }),
		...(input.worktreePath === null ? {} : { worktreePath: input.worktreePath }),
		...(input.conversationHistory === null || input.conversationHistory === undefined
			? {}
			: { conversationHistory: input.conversationHistory }),
	};
}

function persistedEventText(payload: unknown): string | null {
	if (!isRecord(payload)) return null;
	const text = payload['text'];
	return typeof text === 'string' && text.length > 0 ? text : null;
}

export function conversationRecord(
	db: MaliniDatabase,
	sessionId: string,
): AgentConversationMessage[] | null {
	const messages: Array<AgentConversationMessage & { runId: string }> = [];
	for (const row of listTimelineEventRows(db, sessionId)) {
		if (row.kind !== 'user.message' && row.kind !== 'assistant.message') continue;
		const role = row.kind === 'user.message' ? 'user' : 'assistant';
		const content = role === 'user' ? userPromptText(row.payload) : persistedEventText(row.payload);
		if (!content) continue;
		const previous = messages.at(-1);
		if (role === 'assistant' && previous?.role === 'assistant' && previous.runId === row.runId) {
			previous.content += `\n\n${content}`;
		} else {
			messages.push({ role, content, runId: row.runId });
		}
	}

	const retained: AgentConversationMessage[] = [];
	let encodedBytes = 2;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message === undefined) continue;
		const kept = { role: message.role, content: message.content };
		const messageBytes = Buffer.byteLength(JSON.stringify(kept)) + 1;
		if (
			encodedBytes + messageBytes > MAX_RESTORED_CONVERSATION_BYTES ||
			retained.length >= MAX_RESTORED_CONVERSATION_MESSAGES
		) {
			break;
		}
		encodedBytes += messageBytes;
		retained.push(kept);
	}
	retained.reverse();
	return retained.length > 0 ? retained : null;
}

export interface PersistedBridgeSession {
	id: string;
	workstreamId: string;
	model: string | null;
	providerSessionId: string | null;
}

interface PersistedSessionRow {
	id: string;
	workstream_id: string;
	model: string | null;
	provider_session_id: string | null;
}

function fromRow(row: PersistedSessionRow): PersistedBridgeSession {
	return {
		id: row.id,
		workstreamId: row.workstream_id,
		model: row.model,
		providerSessionId: row.provider_session_id,
	};
}

export function persistedBridgeSession(
	db: MaliniDatabase,
	sessionId: string,
): PersistedBridgeSession | null {
	const row = get<PersistedSessionRow>(
		db,
		'SELECT id, workstream_id, model, provider_session_id FROM agent_sessions WHERE id = ?',
		sessionId,
	);
	return row ? fromRow(row) : null;
}

export function persistedBridgeSessions(
	db: MaliniDatabase,
	sessionIds: ReadonlySet<string>,
): PersistedBridgeSession[] {
	if (sessionIds.size === 0) return [];
	return all<PersistedSessionRow>(
		db,
		'SELECT id, workstream_id, model, provider_session_id FROM agent_sessions ORDER BY rowid ASC',
	)
		.filter((row) => sessionIds.has(row.id))
		.map(fromRow);
}

export async function registerPersistedBridgeSession(
	db: MaliniDatabase,
	appDataRoot: string,
	supervisor: BridgeSupervisor,
	session: PersistedBridgeSession,
): Promise<void> {
	const worktree = worktreePath(appDataRoot, session.workstreamId);
	const command = startSessionCommand({
		commandId: supervisor.nextCommandId(),
		sessionId: session.id,
		workstreamId: session.workstreamId,
		model: repairPersistedModel(db, session.id, session.model),
		providerSessionId: session.providerSessionId,
		worktreePath: worktree,
		conversationHistory: conversationRecord(db, session.id),
	});
	await supervisor.sendCommand(command);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
