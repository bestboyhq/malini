export type AgentApprovalDecision = 'allow' | 'deny';

export type AgentApprovalScope = 'once' | 'session' | 'workstream';

export type AgentPermissionCapability =
	'read' | 'write' | 'execute' | 'network' | 'external-service';

export type AgentPermissionResourceKind =
	'path' | 'command' | 'url' | 'project' | 'service' | 'tool';

export type AgentPermissionBoundary =
	'workstream' | 'git-admin' | 'external' | 'sensitive' | 'unknown';

export type AgentPermissionResource = Readonly<{
	kind: AgentPermissionResourceKind;
	value: string;
	canonicalValue?: string;
	boundary: AgentPermissionBoundary;
	readOnly?: boolean;
}>;

export type AgentPermissionDescriptor = Readonly<{
	capability: AgentPermissionCapability;
	resources: readonly AgentPermissionResource[];
}>;

export type AgentQuestionOption = Readonly<{
	label: string;
	description?: string;
}>;

export type AgentQuestion = Readonly<{
	id: string;
	prompt: string;
	header?: string;
	options: readonly AgentQuestionOption[];
	multiSelect: boolean;
	allowFreeText: boolean;
}>;

export type AgentQuestionAnswer = Readonly<{
	questionId: string;
	values: readonly string[];
}>;

export type DecideAgentApprovalInput = Readonly<{
	sessionId: string;
	runId: string;
	approvalId: string;
	decision: AgentApprovalDecision;
	scope: AgentApprovalScope;
	permission?: AgentPermissionDescriptor;
}>;

export type DecideAgentApprovalResult = Readonly<{
	decision: AgentApprovalDecision;
	scope: AgentApprovalScope;
	remembered: boolean;
	ruleId?: string;
}>;

export type AnswerAgentQuestionInput = Readonly<{
	sessionId: string;
	runId: string;
	questionId: string;
	answers: readonly AgentQuestionAnswer[];
}>;
