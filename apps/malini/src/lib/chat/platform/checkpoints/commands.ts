import { CHAT_AGENT_EVENT_CHANNEL, CHAT_CHECKPOINT_RESTORED_CHANNEL } from '$contract/events';
import type { CheckpointRestoredPayload } from '$contract/events';
import type { MainContext } from '$main/context';
import type { EventBus } from '$main/events';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
import type { CommandRegistry } from '$main/ipc/registry';
import { camelEnvelopeJson, type EmitEnvelope } from '../agent/lifecycle';
import { IdSequence } from '../id-sequence';
import { SnapshotRefNamespace } from '../snapshot-refs';
import {
	createCheckpointService,
	type CheckpointService,
	type RunChangeCaptureLeases,
} from './service';

export const CHECKPOINT_COMMAND_NAMES = [
	'chat.run-change-patch',
	'chat.session-change-patch',
	'chat.session-changes',
	'chat.redo-checkpoint-restore',
	'chat.restore-checkpoint',
] as const;

export interface CheckpointDeps {
	readonly resolver: CheckoutResolver;
	readonly leases: RunChangeCaptureLeases;
}

export function installCheckpoints(context: MainContext, deps: CheckpointDeps): CheckpointService {
	const emit: EmitEnvelope = (envelope, seq) =>
		context.events.emit(CHAT_AGENT_EVENT_CHANNEL, camelEnvelopeJson(envelope, seq));
	const service = createCheckpointService(
		{
			db: context.db,
			appDataRoot: context.appDataRoot,
			resolver: deps.resolver,
			ids: new IdSequence(),
			snapshotRefs: new SnapshotRefNamespace(),
		},
		context.events,
		deps.leases,
		emit,
	);
	registerCheckpointCommands(context.commands, context.events, service);
	return service;
}

export function registerCheckpointCommands(
	commands: CommandRegistry,
	events: EventBus,
	service: CheckpointService,
): void {
	commands.define('chat.session-changes', (args: unknown) =>
		service.getSessionChanges({
			...requireScope(args),
			sessionId: requireString(args, 'sessionId'),
		}),
	);

	commands.define('chat.session-change-patch', (args: unknown) =>
		service.getSessionChangePatch({
			...requireScope(args),
			sessionId: requireString(args, 'sessionId'),
			path: requireString(args, 'path'),
		}),
	);

	commands.define('chat.run-change-patch', (args: unknown) =>
		service.getRunChangePatch({
			...requireScope(args),
			sessionId: requireString(args, 'sessionId'),
			runId: requireString(args, 'runId'),
			path: optionalString(args, 'path'),
		}),
	);

	commands.define('chat.restore-checkpoint', async (args: unknown) => {
		const workstreamId = requireString(args, 'workstreamId');
		const checkpointId = requireString(args, 'checkpointId');
		const result = await service.restoreCheckpoint(workstreamId, checkpointId);
		const payload: CheckpointRestoredPayload = {
			workstreamId,
			checkpointId,
			sessionId: result.sessionId,
		};
		events.emit(CHAT_CHECKPOINT_RESTORED_CHANNEL, payload);
		return result;
	});

	commands.define('chat.redo-checkpoint-restore', (args: unknown) =>
		service.redoCheckpointRestore(
			requireString(args, 'workstreamId'),
			requireString(args, 'sessionId'),
			requireNumber(args, 'restoreSeq'),
		),
	);
}

function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string') throw new Error(`invalid args: \`${key}\` must be a string`);
	return value;
}

function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') {
		throw new Error(`invalid args: \`${key}\` must be a string when present`);
	}
	return value;
}

function requireNumber(args: unknown, key: string): number {
	const value = field(args, key);
	if (typeof value !== 'number') throw new Error(`invalid args: \`${key}\` must be a number`);
	return value;
}

function requireScope(args: unknown): { workstreamId: string } {
	return { workstreamId: requireString(args, 'workstreamId') };
}
