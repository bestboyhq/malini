import type { AutomationDefinitionRecord } from './automations';

export type MaliniEditReview = Readonly<{
	kind: 'automation';
	current: AutomationDefinitionRecord;
}>;

export type PermissionGrantScope = 'session' | 'workstream' | 'everywhere';

export type PermissionGrantRecord = Readonly<{
	id: string;
	scope: PermissionGrantScope;
	what: string;
	workstreamName: string | null;
	createdAt: string;
	lastUsedAt: string | null;
}>;

export type RevokePermissionGrantArgs = Readonly<{ grantId: string }>;
