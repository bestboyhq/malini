import type { MaliniEditReview } from '$contract/approvals';
import type { JobDefinitionRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { jobDefinitions } from '$lib/jobs/jobs.platform';
import { hasActivePermissionRule } from '../permissions.repository';
import {
	MALINI_TOOL_PREFIX,
	maliniActionFingerprint,
	maliniActionPermission,
	type MaliniActionPermission,
} from '../permissions.service';
import type { BridgeEvent } from './protocol';

export type MaliniApproval = Readonly<{
	permission: MaliniActionPermission | null;
	review: MaliniEditReview | null;
}>;

const ASK: MaliniApproval = { permission: null, review: null };

export function withMaliniApproval(db: MaliniDatabase, event: BridgeEvent): BridgeEvent {
	if (event.type !== 'approval.requested') return event;
	const approval = safely(() => assessMaliniApproval(db, event.toolName, event.input));
	if (approval === null) return event;
	const request = { ...event };
	delete request.permission;
	return {
		...request,
		...(approval.permission ? { permission: approval.permission } : {}),
		...(approval.review ? { review: approval.review } : {}),
	};
}

export function assessMaliniApproval(
	db: MaliniDatabase,
	toolName: string | undefined,
	input: unknown,
): MaliniApproval | null {
	if (!toolName?.startsWith(MALINI_TOOL_PREFIX)) return null;
	const field = (key: string): string | undefined => {
		const value: unknown = typeof input === 'object' && input ? Reflect.get(input, key) : null;
		return typeof value === 'string' ? value : undefined;
	};
	const id = field('id');
	switch (toolName.slice(MALINI_TOOL_PREFIX.length)) {
		case 'pull_requests_open_draft':
			return grant('pull-requests.open-draft');
		case 'jobs_run': {
			const [job, ...others] = jobsNamed(jobDefinitions(db), field('job') ?? '');
			return job && others.length === 0 ? grant(`jobs.run:${job.id}`) : ASK;
		}
		case 'jobs_save': {
			if (id === undefined) return grant('jobs.save');
			const definitions = jobDefinitions(db);
			const job = definitions.find((definition) => definition.id === id);
			if (!job) return ASK;
			return runsWithoutAsking(db, definitions, job)
				? { permission: null, review: { kind: 'job', current: job } }
				: grant('jobs.save');
		}
		default:
			return ASK;
	}
}

export function jobsNamed(
	definitions: readonly JobDefinitionRecord[],
	reference: string,
): JobDefinitionRecord[] {
	const byId = definitions.find((definition) => definition.id === reference);
	if (byId) return [byId];
	const wanted = reference.trim().toLocaleLowerCase();
	return definitions.filter((definition) => definition.name.toLocaleLowerCase() === wanted);
}

export function maliniActionLabel(db: MaliniDatabase, action: string): string {
	if (action === 'pull-requests.open-draft') return 'Open draft pull requests';
	if (action === 'jobs.save') return 'Save jobs';
	const jobId = action.slice('jobs.run:'.length);
	const job = jobDefinitions(db).find((definition) => definition.id === jobId);
	return `Run ‘${job?.name ?? jobId}’`;
}

function runsWithoutAsking(
	db: MaliniDatabase,
	definitions: readonly JobDefinitionRecord[],
	job: JobDefinitionRecord,
	visited = new Set<string>(),
): boolean {
	if (visited.has(job.id)) return false;
	visited.add(job.id);
	return (
		job.builtin !== null ||
		hasActivePermissionRule(db, maliniActionFingerprint(`jobs.run:${job.id}`)) ||
		(job.trigger !== null && job.trigger.mode !== 'off') ||
		definitions.some(
			(before) =>
				before.thenJobId === job.id && runsWithoutAsking(db, definitions, before, visited),
		)
	);
}

function safely(assess: () => MaliniApproval | null): MaliniApproval | null {
	try {
		return assess();
	} catch {
		return ASK;
	}
}

function grant(action: string): MaliniApproval {
	return { permission: maliniActionPermission(action), review: null };
}
