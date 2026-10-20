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

const RUNS_IN_COPY: Readonly<Record<string, string>> = {
	workstream: 'The workstream it is started from',
	'new-workstream': 'A new workstream',
};

const OUTPUT_COPY: Readonly<Record<string, string>> = {
	none: 'Leave the changes to you',
	draft: 'Open a draft PR',
	merge: 'Queue the merge',
};

export function maliniToolApproval(
	toolName: string | undefined,
	input: unknown,
	jobName: (reference: string) => string = (reference) => reference,
): MaliniToolApproval | null {
	if (typeof input !== 'object' || input === null) return null;
	const field = (key: string): string | undefined => {
		const value: unknown = Reflect.get(input, key);
		return typeof value === 'string' && value.trim() ? value : undefined;
	};
	const runsIn = field('runsIn');
	const output = field('output');
	switch (toolName) {
		case 'mcp__malini__routines_save': {
			const steps: unknown = Reflect.get(input, 'steps');
			const jobs = Array.isArray(steps)
				? steps.filter((step) => typeof step === 'string').map(jobName)
				: [];
			return {
				headline: named('Save routine', field('label') ?? field('id')),
				details: present([
					['When', field('when')],
					['Runs', jobs.length > 0 ? jobs.join(' → ') : undefined],
					[
						'Starts as',
						field('id') === undefined ? 'A draft you promote on the Jobs page' : undefined,
					],
				]),
			};
		}
		case 'mcp__malini__jobs_save':
			return {
				headline: named('Save job', field('name') ?? field('id')),
				details: present([
					['Runs in', runsIn && (RUNS_IN_COPY[runsIn] ?? runsIn)],
					['When done', output && (OUTPUT_COPY[output] ?? output)],
					['Model', field('model')],
					['Effort', field('effort')],
					['Instructions', field('instructions')],
				]),
			};
		case 'mcp__malini__jobs_run': {
			const job = field('job');
			return {
				headline: named('Run job', job && jobName(job)),
				details: present([['Context', field('context')]]),
			};
		}
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
