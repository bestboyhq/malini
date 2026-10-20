import type {
	AgentApprovalDecision,
	AgentApprovalScope,
	AgentPermissionDescriptor,
} from './agent-interaction';

export type AgentInteractionKind = 'approval' | 'question';

export type AgentInteractionReference = Readonly<{
	kind: AgentInteractionKind;
	sessionId: string;
	runId: string;
	requestId: string;
}>;

export type AgentInteractionState =
	| Readonly<{ status: 'idle' }>
	| Readonly<{ status: 'submitting' }>
	| Readonly<{ status: 'stale'; message: string }>
	| Readonly<{ status: 'error'; message: string }>
	| Readonly<{
			status: 'resolved';
			message: string;
			decision?: AgentApprovalDecision;
			requestedScope?: AgentApprovalScope;
			scopeStored?: boolean;
			ruleId?: string;
	  }>;

export function agentInteractionKey(reference: AgentInteractionReference): string {
	return `${reference.kind}:${reference.sessionId}:${reference.runId}:${reference.requestId}`;
}

export function canPersistAgentApproval(
	permission: AgentPermissionDescriptor | undefined,
): boolean {
	if (!permission) return false;
	return (
		permission.capability === 'read' &&
		permission.resources.length > 0 &&
		permission.resources.every(
			(resource) =>
				resource.kind === 'path' &&
				resource.boundary === 'external' &&
				typeof resource.canonicalValue === 'string' &&
				looksCanonicalAbsolutePath(resource.canonicalValue),
		)
	);
}

function looksCanonicalAbsolutePath(value: string): boolean {
	const normalized = value.trim().replaceAll('\\', '/');
	if (!normalized.startsWith('/') && !/^[A-Za-z]:\//u.test(normalized)) return false;
	return normalized.split('/').every((component) => component !== '.' && component !== '..');
}
