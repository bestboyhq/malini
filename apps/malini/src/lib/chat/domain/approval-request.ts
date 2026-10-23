import type { MaliniEditReview } from '$contract/approvals';
import type { AgentPermissionDescriptor, AgentPermissionResourceKind } from './agent-interaction';

export type ApprovalTarget = Readonly<{ kind: AgentPermissionResourceKind; value: string }>;

const TARGET_KINDS = new Set(['path', 'command', 'url']);

export function approvalHeadline(
	toolName: string | undefined,
	permission: AgentPermissionDescriptor | undefined,
): string {
	const resources = permission?.resources ?? [];
	const files = resources.filter((resource) => resource.kind === 'path').length > 1;
	const fileNoun = files ? 'files' : 'a file';
	const tool = toolName ?? 'a tool';
	if (permission?.capability === 'read') return `Claude wants to read ${fileNoun}`;
	if (permission?.capability === 'write') return `Claude wants to edit ${fileNoun}`;
	if (permission?.capability === 'network') {
		if (toolName === 'WebSearch') return 'Claude wants to search the web';
		if (toolName === 'WebFetch') return 'Claude wants to fetch a web page';
		return 'Claude wants to reach the network';
	}
	if (permission?.capability === 'external-service') {
		const service = resources.find((resource) => resource.kind === 'service')?.value;
		return `Claude wants to use ${service ?? tool}`;
	}
	if (resources.some((resource) => resource.kind === 'command')) {
		return 'Claude wants to run a command';
	}
	return `Claude wants to use ${tool}`;
}

export function approvalTargets(
	permission: AgentPermissionDescriptor | undefined,
): readonly ApprovalTarget[] {
	return (permission?.resources ?? [])
		.filter((resource) => TARGET_KINDS.has(resource.kind) && resource.value.trim())
		.map((resource) => ({ kind: resource.kind, value: resource.canonicalValue ?? resource.value }));
}

export function approvalShortTarget(
	toolName: string | undefined,
	permission: AgentPermissionDescriptor | undefined,
): string {
	const resource = (permission?.resources ?? []).find(
		(candidate) => TARGET_KINDS.has(candidate.kind) && candidate.value.trim(),
	);
	if (!resource) return toolName ?? 'tool';
	if (resource.kind !== 'path') return resource.value;
	return resource.value.split('/').filter(Boolean).at(-1) ?? resource.value;
}

export function approvalReason(reason: string): string | null {
	const trimmed = reason.trim();
	return trimmed && !trimmed.startsWith('Claude wants to') ? trimmed : null;
}

export type ApprovalDetail = Readonly<{ label: string; value: string }>;

export type MaliniToolApproval = Readonly<{ headline: string; details: readonly ApprovalDetail[] }>;

export const RUNS_IN_COPY: Readonly<Record<string, string>> = {
	workstream: 'The workstream it is started from',
	'new-workstream': 'A new workstream',
};

export const MODE_COPY: Readonly<Record<string, string>> = {
	off: 'Off',
	ask: 'Ask me first',
	auto: 'On its own',
};

export const NO_TRIGGER = 'Only when you run it';

export const NO_THEN = 'Nothing';

export type MaliniNames = Readonly<{
	job: (reference: string) => string;
	workstream: (reference: string) => string;
}>;

const AS_GIVEN: MaliniNames = {
	job: (reference) => reference,
	workstream: (reference) => reference,
};

export function maliniToolApproval(
	toolName: string | undefined,
	input: unknown,
	names: MaliniNames = AS_GIVEN,
	review?: MaliniEditReview,
): MaliniToolApproval | null {
	if (typeof input !== 'object' || input === null) return null;
	const field = (key: string): string | undefined => {
		const value: unknown = Reflect.get(input, key);
		return typeof value === 'string' && value.trim() ? value : undefined;
	};
	const runsIn = field('runsIn');
	const id = field('id');
	const when = field('when');
	const then = field('then');
	const cleared = (key: string): boolean => Reflect.get(input, key) === null;
	const { job: jobName } = names;
	const repository = field('repository');
	const workstream = field('workstream');
	switch (toolName) {
		case 'mcp__malini__jobs_save':
			return {
				headline: named('Save job', field('name') ?? review?.current.name ?? (id && jobName(id))),
				details: present([
					['Runs in', runsIn && (RUNS_IN_COPY[runsIn] ?? runsIn)],
					['When', cleared('when') ? NO_TRIGGER : when],
					['Runs', when && 'Off until you turn it on in the Jobs page'],
					['Then', cleared('then') ? NO_THEN : then && jobName(then)],
					['Model', field('model')],
					['Effort', field('effort')],
					['Instructions', field('instructions')],
				]),
			};
		case 'mcp__malini__jobs_run': {
			const job = field('job');
			return {
				headline: named('Run job', job && jobName(job)),
				details: present([
					['In', workstream && names.workstream(workstream)],
					['Context', field('context')],
				]),
			};
		}
		case 'mcp__malini__repositories_clone':
			return { headline: named('Clone', repository), details: [] };
		case 'mcp__malini__repositories_hide':
			return {
				headline: named('Hide', repository),
				details: [{ label: 'Keeps', value: 'Its clone and workstreams, under Hidden' }],
			};
		case 'mcp__malini__workstreams_create':
			return {
				headline: named('Start a workstream in', repository),
				details: present([
					['Name', field('name')],
					['First message', field('prompt')],
				]),
			};
		case 'mcp__malini__workstreams_archive':
			return {
				headline: named('Archive', workstream && names.workstream(workstream)),
				details: [{ label: 'Keeps', value: 'Its branch and uncommitted work, under Archived' }],
			};
		default:
			return null;
	}
}

function named(action: string, name: string | undefined): string {
	return name ? `${action} ‘${name}’` : action;
}

function present(rows: readonly (readonly [string, string | undefined])[]): ApprovalDetail[] {
	return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}
