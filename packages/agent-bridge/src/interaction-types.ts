export type ApprovalDecision = 'allow' | 'deny';

export type ApprovalScope = 'once' | 'session' | 'workstream';

export type PermissionCapability = 'read' | 'write' | 'execute' | 'network' | 'external-service';

export type PermissionResourceKind = 'path' | 'command' | 'url' | 'project' | 'service' | 'tool';

export type PermissionBoundary = 'workstream' | 'git-admin' | 'external' | 'sensitive' | 'unknown';

export interface PermissionResourceDescriptor {
	readonly kind: PermissionResourceKind;
	readonly value: string;
	readonly canonicalValue?: string;
	readonly boundary: PermissionBoundary;
	readonly readOnly?: boolean;
}

export interface ProviderPermissionDescriptor {
	readonly capability: PermissionCapability;
	readonly resources: readonly PermissionResourceDescriptor[];
}

export interface ProviderApprovalReply {
	readonly sessionId: string;
	readonly runId: string;
	readonly approvalId: string;
	readonly decision: ApprovalDecision;
	readonly scope: ApprovalScope;
}

export interface AgentQuestionOption {
	readonly label: string;
	readonly description?: string;
}

export interface AgentQuestion {
	readonly id: string;
	readonly prompt: string;
	readonly header?: string;
	readonly options: readonly AgentQuestionOption[];
	readonly multiSelect: boolean;
	readonly allowFreeText: boolean;
}

export interface AgentQuestionAnswer {
	readonly questionId: string;
	readonly values: readonly string[];
}

export interface ProviderQuestionReply {
	readonly sessionId: string;
	readonly runId: string;
	readonly questionId: string;
	readonly answers: readonly AgentQuestionAnswer[];
}

export interface ProviderApprovalResolution extends ProviderApprovalReply {
	readonly reason?: string;
}

export type ProviderQuestionResolution =
	| { readonly behavior: 'answered'; readonly reply: ProviderQuestionReply }
	| { readonly behavior: 'cancelled'; readonly reason: string };

export interface ProviderApprovalRequest {
	readonly runId: string;
	readonly approvalId: string;
	readonly reason: string;
	readonly toolName?: string;
	readonly input?: unknown;
	readonly permission?: ProviderPermissionDescriptor;
	readonly signal?: AbortSignal;
}

export interface ProviderQuestionRequest {
	readonly runId: string;
	readonly questionId: string;
	readonly questions: readonly AgentQuestion[];
	readonly toolName?: string;
	readonly toolCallId?: string;
	readonly signal?: AbortSignal;
}

export interface ProviderInteractionRequester {
	requestApproval(request: ProviderApprovalRequest): Promise<ProviderApprovalResolution>;
	requestQuestion(request: ProviderQuestionRequest): Promise<ProviderQuestionResolution>;
}
