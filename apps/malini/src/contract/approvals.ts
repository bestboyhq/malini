import type { JobDefinitionRecord } from './jobs';

export type MaliniEditReview = Readonly<{ kind: 'job'; current: JobDefinitionRecord }>;

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
