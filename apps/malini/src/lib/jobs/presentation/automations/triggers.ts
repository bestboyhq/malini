import { parseAutomationTrigger } from '$contract/automation-trigger';
import {
	isAutomaticJobBuiltin,
	type JobBuiltin,
	type JobDefinitionRecord,
	type JobOutput,
	type JobRunsIn,
} from '$contract/jobs';
import type { JobTrigger, RoutineStatus } from '$contract/routines';
import type { IconName } from '$hyper-ui/icons';
import { BUILTIN_WHEN, jobWhenDetail } from '../job-definition-copy';

export type TriggerGroup = 'You' | 'Shipping' | 'Workstreams' | 'Chats' | 'Jobs' | 'Malini';

export type Trigger = Readonly<{
	id: string;
	when: string | null;
	group: TriggerGroup;
	label: string;
	detail: string;
	icon: IconName;
}>;

export type TriggerLook = Readonly<{ label: string; icon: IconName }>;

export const MANUAL_TRIGGER: Trigger = {
	id: 'manual',
	when: null,
	group: 'You',
	label: 'When you run it',
	detail: 'From any chat with /, or from here',
	icon: 'play',
};

export const TRIGGER_GROUPS: readonly TriggerGroup[] = [
	'You',
	'Shipping',
	'Workstreams',
	'Chats',
	'Jobs',
	'Malini',
];

export const TRIGGERS: readonly Trigger[] = [
	MANUAL_TRIGGER,
	{
		id: 'pr-merged',
		when: 'on pull-requests:ship-changed where merged is set',
		group: 'Shipping',
		label: 'A pull request merges',
		detail: 'Malini merged a pull request it shipped',
		icon: 'pr-merged',
	},
	{
		id: 'ship-needs-you',
		when: 'on pull-requests:ship-changed where state.phase is needs-you',
		group: 'Shipping',
		label: 'Shipping needs you',
		detail: 'The merge queue stops and waits for you',
		icon: 'shield-alert',
	},
	{
		id: 'workstream-created',
		when: 'when a new workstream is created',
		group: 'Workstreams',
		label: 'A workstream is created',
		detail: 'Its checkout is ready for chats',
		icon: 'folder-plus',
	},
	{
		id: 'install-succeeded',
		when: 'on repositories:workstream-install-status where status is succeeded',
		group: 'Workstreams',
		label: 'Dependencies finish installing',
		detail: 'A new workstream is installed and ready',
		icon: 'cube',
	},
	{
		id: 'install-failed',
		when: 'on repositories:workstream-install-status where status is failed',
		group: 'Workstreams',
		label: 'Dependency install fails',
		detail: 'A new workstream could not install',
		icon: 'warning',
	},
	{
		id: 'frontend-ready',
		when: 'when a frontend resource becomes ready',
		group: 'Workstreams',
		label: 'A frontend comes up',
		detail: 'A dev server or container is ready',
		icon: 'globe',
	},
	{
		id: 'workstream-archived',
		when: 'on repositories:workstream-removed where archived is set',
		group: 'Workstreams',
		label: 'A workstream is archived',
		detail: 'It leaves the sidebar',
		icon: 'archive',
	},
	{
		id: 'files-changed',
		when: 'on chat:run-changes-captured',
		group: 'Chats',
		label: 'An agent changes files',
		detail: 'A run that edited files finishes',
		icon: 'diff',
	},
	{
		id: 'job-failed',
		when: 'on jobs:run-changed where run.status is failed',
		group: 'Jobs',
		label: 'A job fails',
		detail: 'Any job run ends as failed',
		icon: 'close',
	},
	{
		id: 'job-needs-you',
		when: 'on jobs:run-changed where run.status is needs-you',
		group: 'Jobs',
		label: 'A job needs you',
		detail: 'A job run stops and waits for you',
		icon: 'alert',
	},
	{
		id: 'malini-updated',
		when: 'on app:updated',
		group: 'Malini',
		label: 'Malini updates',
		detail: 'A new version starts',
		icon: 'sparkles',
	},
];

const BUILTIN_TRIGGER_ICONS: Readonly<Partial<Record<JobBuiltin, IconName>>> = {
	'name-chats': 'chat',
	'name-services': 'terminal',
	'fix-checks': 'pr-failed',
	'update-from-main': 'branch',
	'address-review': 'pr-open',
	'check-compatibility': 'sparkles',
};

export const RUN_MODES: readonly Readonly<{
	value: RoutineStatus;
	label: string;
	hint: string;
}>[] = [
	{ value: 'draft', label: 'Off', hint: 'Never starts on its own' },
	{ value: 'candidate', label: 'Ask me first', hint: 'Each run waits for your yes' },
	{ value: 'routine', label: 'On its own', hint: 'Runs as soon as it fires' },
];

export const EVENT_RUNS_IN_OPTIONS: readonly Readonly<{ value: JobRunsIn; label: string }>[] = [
	{ value: 'workstream', label: 'The workstream it fires in' },
	{ value: 'new-workstream', label: 'A new workstream' },
];

const RUNS_IN_PHRASE: Readonly<Record<JobRunsIn, string>> = {
	workstream: 'in the workstream it fires in',
	'new-workstream': 'in a new workstream',
};

const MANUAL_RUNS_IN_PHRASE: Readonly<Record<JobRunsIn, string>> = {
	workstream: 'in the workstream you pick',
	'new-workstream': 'in a new workstream',
};

const OUTPUT_PHRASE: Readonly<Record<JobOutput, string>> = {
	none: 'leave the changes to you',
	draft: 'open a draft PR',
	merge: 'queue the merge',
};

const STATUS_SUFFIX: Readonly<Record<RoutineStatus, string>> = {
	draft: ' It is off for now.',
	candidate: ' It asks you first.',
	routine: '',
};

export function triggerById(id: string): Trigger {
	return TRIGGERS.find((trigger) => trigger.id === id) ?? MANUAL_TRIGGER;
}

export function triggerFor(when: string | null): Trigger {
	if (when === null) return MANUAL_TRIGGER;
	return TRIGGERS.find((trigger) => trigger.when === when) ?? customTrigger(when);
}

export function builtinTrigger(job: Pick<JobDefinitionRecord, 'builtin'>): TriggerLook | null {
	if (job.builtin === null) return null;
	const icon = BUILTIN_TRIGGER_ICONS[job.builtin];
	return icon ? { label: BUILTIN_WHEN[job.builtin], icon } : null;
}

export function jobTriggerLook(
	job: Pick<JobDefinitionRecord, 'builtin'>,
	trigger: JobTrigger | null,
): TriggerLook {
	return builtinTrigger(job) ?? triggerFor(trigger?.when ?? null);
}

export function runModeLabel(status: RoutineStatus): string {
	return RUN_MODES.find((mode) => mode.value === status)?.label ?? status;
}

export function runModeHint(status: RoutineStatus): string {
	return RUN_MODES.find((mode) => mode.value === status)?.hint ?? '';
}

export function whenClause(look: TriggerLook): string {
	if (look.label === MANUAL_TRIGGER.label) return look.label;
	const lead = look.label.startsWith('Malini')
		? look.label.charAt(0)
		: look.label.charAt(0).toLowerCase();
	return `When ${lead}${look.label.slice(1)}`;
}

export function jobSentence(job: JobDefinitionRecord, trigger: JobTrigger | null): string {
	if (builtinTrigger(job) !== null) {
		return isAutomaticJobBuiltin(job.builtin)
			? `${whenClause(jobTriggerLook(job, null))}, ${job.name} runs in the background.`
			: jobWhenDetail(job);
	}
	const when = whenClause(jobTriggerLook(job, trigger));
	const runsIn = (trigger === null ? MANUAL_RUNS_IN_PHRASE : RUNS_IN_PHRASE)[job.runsIn];
	const suffix = trigger === null ? '' : STATUS_SUFFIX[trigger.status];
	return `${when}, ${job.name} runs ${runsIn} and will ${OUTPUT_PHRASE[job.output]}.${suffix}`;
}

function customTrigger(when: string): Trigger {
	return {
		id: when,
		when,
		group: 'Malini',
		label: customLabel(when),
		detail: 'A Malini event',
		icon: 'signal',
	};
}

function customLabel(when: string): string {
	try {
		const parsed = parseAutomationTrigger(when);
		if (parsed.kind === 'event') return when.replace(/^on\s+/u, '');
		const rest = parsed.description.replace(/^When\s+/u, '');
		return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
	} catch {
		return when;
	}
}
