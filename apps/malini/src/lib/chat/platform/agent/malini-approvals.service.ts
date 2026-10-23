import type { MaliniEditReview } from '$contract/approvals';
import type { JobDefinitionRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { jobDefinitions } from '$lib/jobs/jobs.platform';
import { routines } from '$lib/routines/routines.platform';
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
			const job = jobDefinitions(db).find((definition) => definition.id === id);
			if (!job) return ASK;
			return runsWithoutAsking(db, job)
				? { permission: null, review: { kind: 'job', current: job } }
				: grant('jobs.save');
		}
		case 'routines_save': {
			if (id === undefined) return grant('routines.save');
			const routine = routines(db).find((candidate) => candidate.id === id);
			if (!routine) return ASK;
			return routine.status === 'draft'
				? grant('routines.save')
				: { permission: null, review: { kind: 'routine', current: routine } };
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
	if (action === 'routines.save') return 'Save draft routines';
	const jobId = action.slice('jobs.run:'.length);
	const job = jobDefinitions(db).find((definition) => definition.id === jobId);
	return `Run ‘${job?.name ?? jobId}’`;
}

function runsWithoutAsking(db: MaliniDatabase, job: JobDefinitionRecord): boolean {
	return (
		job.builtin !== null ||
		hasActivePermissionRule(db, maliniActionFingerprint(`jobs.run:${job.id}`)) ||
		routines(db).some(
			(routine) =>
				routine.status !== 'draft' &&
				routine.steps.some((step) => 'job' in step && step.job === job.id),
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
