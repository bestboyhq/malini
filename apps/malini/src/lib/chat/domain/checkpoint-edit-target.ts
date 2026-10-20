import type { AgentModel } from '$shared/providers/domain/model-id';
import type { AgentRunProfile } from '$shared/providers/domain/run-profile';
import type { SessionId } from './session';

export type CheckpointEditTarget = Readonly<{
	workstreamId: string;
	sessionId: SessionId;
	model: AgentModel;
	profile: AgentRunProfile;
}>;

export function captureCheckpointEditTarget(input: {
	workstreamId: string;
	sessionId: SessionId | null;
	model: AgentModel;
	profile: AgentRunProfile;
}): CheckpointEditTarget | null {
	if (!input.workstreamId || !input.sessionId) return null;
	return {
		workstreamId: input.workstreamId,
		sessionId: input.sessionId,
		model: input.model,
		profile: { ...input.profile },
	};
}

export function checkpointEditTargetIsCurrent(
	target: Pick<CheckpointEditTarget, 'workstreamId' | 'sessionId'>,
	current: {
		workstreamId: string;
		sessionId: SessionId | null;
		navigationTargetsWorkstream: boolean;
	},
): boolean {
	return (
		current.navigationTargetsWorkstream &&
		current.workstreamId === target.workstreamId &&
		current.sessionId === target.sessionId
	);
}

export async function executeCheckpointEdit(
	target: CheckpointEditTarget,
	operations: {
		restore(target: CheckpointEditTarget): Promise<boolean>;
		isCurrent(target: CheckpointEditTarget): boolean;
		submit(target: CheckpointEditTarget): void | Promise<void>;
	},
): Promise<boolean> {
	const restored = await operations.restore(target);
	if (!restored || !operations.isCurrent(target)) return false;
	await operations.submit(target);
	return true;
}
