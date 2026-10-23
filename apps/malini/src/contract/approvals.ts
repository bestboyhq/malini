import type { JobDefinitionRecord } from './jobs';
import type { RoutineRecord } from './routines';

export type MaliniEditReview =
	| Readonly<{ kind: 'job'; current: JobDefinitionRecord }>
	| Readonly<{ kind: 'routine'; current: RoutineRecord }>;

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
