import type { AutomationDefinitionRecord } from './automations';

export type MaliniEditReview = Readonly<{
	kind: 'automation';
	current: AutomationDefinitionRecord;
}>;

export type PermissionGrantScope = 'session' | 'workstream' | 'repository' | 'everywhere';

export type PermissionGrantRecord = Readonly<{
	id: string;
	scope: PermissionGrantScope;
	what: string;
	workstreamName: string | null;
	repositoryName: string | null;
	createdAt: string;
	lastUsedAt: string | null;
}>;

export type RevokePermissionGrantArgs = Readonly<{ grantId: string }>;
