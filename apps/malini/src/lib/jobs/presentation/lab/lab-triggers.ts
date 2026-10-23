import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
import type { IconName } from '$hyper-ui/icons';

export type LabTriggerGroup = 'You' | 'Shipping' | 'Workstreams' | 'Chats' | 'Jobs' | 'Malini';

export type LabTrigger = Readonly<{
	id: string;
	group: LabTriggerGroup;
	label: string;
	detail: string;
	phrase: string;
	icon: IconName;
}>;

export type LabRunMode = 'off' | 'ask' | 'auto';

export type LabJobSetup = Readonly<{
	triggerId: string;
	mode: LabRunMode;
	phrase?: string;
	runsIn?: JobDefinitionRecord['runsIn'];
	output?: JobDefinitionRecord['output'];
}>;

export const LAB_MANUAL_TRIGGER_ID = 'manual';

export const LAB_CUSTOM_TRIGGER_ID = 'custom-event';

export const LAB_TRIGGER_GROUPS: readonly LabTriggerGroup[] = [
	'You',
	'Shipping',
	'Workstreams',
	'Chats',
	'Jobs',
	'Malini',
];

export const LAB_TRIGGERS: readonly LabTrigger[] = [
	{
		id: LAB_MANUAL_TRIGGER_ID,
		group: 'You',
		label: 'When you run it',
		detail: 'From any chat with /, or from here',
		phrase: 'when I run it',
		icon: 'play',
	},
	{
		id: 'pr-merged',
		group: 'Shipping',
		label: 'A pull request merges',
		detail: 'Malini merged a pull request it shipped',
		phrase: 'on pull-requests:ship-changed where merged is set',
		icon: 'pr-merged',
	},
	{
		id: 'checks-fail',
		group: 'Shipping',
		label: 'Checks fail while shipping',
		detail: 'The merge queue hits a failing check',
		phrase: 'when checks fail in the merge queue',
		icon: 'pr-failed',
	},
	{
		id: 'behind-main',
		group: 'Shipping',
		label: 'Main moves ahead',
		detail: 'A shipping branch falls behind its base',
		phrase: 'when the branch falls behind main',
		icon: 'branch',
	},
	{
		id: 'bot-review',
		group: 'Shipping',
		label: 'A bot reviews the pull request',
		detail: 'Review comments land on a shipping pull request',
		phrase: 'when a bot reviews the pull request',
		icon: 'pr-open',
	},
	{
		id: 'ship-needs-you',
		group: 'Shipping',
		label: 'Shipping needs you',
		detail: 'The merge queue stops and waits for you',
		phrase: 'on pull-requests:ship-changed where state.phase is needs-you',
		icon: 'shield-alert',
	},
	{
		id: 'workstream-created',
		group: 'Workstreams',
		label: 'A workstream is created',
		detail: 'Its checkout is ready for chats',
		phrase: 'when a new workstream is created',
		icon: 'folder-plus',
	},
	{
		id: 'workstream-opened',
		group: 'Workstreams',
		label: 'You open a workstream',
		detail: 'Only the workstream you look at',
		phrase: 'when you open the workstream',
		icon: 'folder-open',
	},
	{
		id: 'install-succeeded',
		group: 'Workstreams',
		label: 'Dependencies finish installing',
		detail: 'A new workstream is installed and ready',
		phrase: 'on repositories:workstream-install-status where status is succeeded',
		icon: 'cube',
	},
	{
		id: 'install-failed',
		group: 'Workstreams',
		label: 'Dependency install fails',
		detail: 'A new workstream could not install',
		phrase: 'on repositories:workstream-install-status where status is failed',
		icon: 'warning',
	},
	{
		id: 'frontend-ready',
		group: 'Workstreams',
		label: 'A frontend comes up',
		detail: 'A dev server or container is ready',
		phrase: 'when a frontend resource becomes ready',
		icon: 'globe',
	},
	{
		id: 'workstream-archived',
		group: 'Workstreams',
		label: 'A workstream is archived',
		detail: 'It leaves the sidebar',
		phrase: 'on repositories:workstream-removed where archived is set',
		icon: 'archive',
	},
	{
		id: 'first-message',
		group: 'Chats',
		label: 'You start a chat',
		detail: 'Your first message in a chat',
		phrase: 'when you send the first message in a chat',
		icon: 'chat',
	},
	{
		id: 'files-changed',
		group: 'Chats',
		label: 'An agent changes files',
		detail: 'A run that edited files finishes',
		phrase: 'on chat:run-changes-captured',
		icon: 'diff',
	},
	{
		id: 'service-left',
		group: 'Chats',
		label: 'An agent leaves a command running',
		detail: 'A dev server or watcher keeps going',
		phrase: 'when an agent leaves a command running',
		icon: 'terminal',
	},
	{
		id: 'job-failed',
		group: 'Jobs',
		label: 'A job fails',
		detail: 'Any job run ends as failed',
		phrase: 'on jobs:run-changed where run.status is failed',
		icon: 'close',
	},
	{
		id: 'job-needs-you',
		group: 'Jobs',
		label: 'A job needs you',
		detail: 'A job run stops and waits for you',
		phrase: 'on jobs:run-changed where run.status is needs-you',
		icon: 'alert',
	},
	{
		id: 'malini-updated',
		group: 'Malini',
		label: 'Malini updates',
		detail: 'A new version starts',
		phrase: 'on app:updated',
		icon: 'sparkles',
	},
];

const BUILTIN_SETUP: Readonly<Record<NonNullable<JobDefinitionRecord['builtin']>, LabJobSetup>> = {
	'name-chats': { triggerId: 'first-message', mode: 'auto' },
	'name-services': { triggerId: 'service-left', mode: 'auto' },
	'fix-checks': { triggerId: 'checks-fail', mode: 'auto' },
	'update-from-main': { triggerId: 'behind-main', mode: 'auto' },
	'address-review': { triggerId: 'bot-review', mode: 'auto' },
	'check-compatibility': { triggerId: 'malini-updated', mode: 'auto' },
	'update-docs': { triggerId: LAB_MANUAL_TRIGGER_ID, mode: 'auto' },
};

export function labDefaultSetup(definition: JobDefinitionRecord): LabJobSetup {
	const where = { runsIn: definition.runsIn, output: definition.output };
	if (definition.builtin === null) {
		return { triggerId: LAB_MANUAL_TRIGGER_ID, mode: 'auto', ...where };
	}
	return { ...BUILTIN_SETUP[definition.builtin], ...where };
}

export function labTrigger(setup: LabJobSetup): LabTrigger {
	const known = LAB_TRIGGERS.find((trigger) => trigger.id === setup.triggerId);
	if (known) return known;
	const phrase = setup.phrase ?? '';
	return {
		id: LAB_CUSTOM_TRIGGER_ID,
		group: 'Malini',
		label: phrase.replace(/^on\s+/u, ''),
		detail: 'A Malini event',
		phrase,
		icon: 'signal',
	};
}

export function labIsManual(setup: LabJobSetup): boolean {
	return setup.triggerId === LAB_MANUAL_TRIGGER_ID;
}

export const LAB_RUN_MODES: readonly Readonly<{
	value: LabRunMode;
	label: string;
	hint: string;
}>[] = [
	{ value: 'off', label: 'Off', hint: 'Never starts on its own' },
	{ value: 'ask', label: 'Ask me first', hint: 'Each run waits for your yes' },
	{ value: 'auto', label: 'On its own', hint: 'Runs as soon as it fires' },
];

export const LAB_RUNS_IN_LABEL: Readonly<Record<JobDefinitionRecord['runsIn'], string>> = {
	workstream: 'in that workstream',
	'new-workstream': 'in a new workstream',
};

export const LAB_OUTPUT_LABEL: Readonly<Record<JobDefinitionRecord['output'], string>> = {
	none: 'leave the changes to you',
	draft: 'open a draft PR',
	merge: 'queue the merge',
};

const MODE_SUFFIX: Readonly<Record<LabRunMode, string>> = {
	off: ' It is off for now.',
	ask: ' It asks you first.',
	auto: '',
};

export function labWhenClause(setup: LabJobSetup): string {
	if (labIsManual(setup)) return 'When you run it';
	const { label } = labTrigger(setup);
	const lead = label.startsWith('Malini') ? label.charAt(0) : label.charAt(0).toLowerCase();
	return `When ${lead}${label.slice(1)}`;
}

export function labSentence(definition: JobDefinitionRecord, setup: LabJobSetup): string {
	const when = labWhenClause(setup);
	const runsIn = LAB_RUNS_IN_LABEL[setup.runsIn ?? definition.runsIn];
	const output = LAB_OUTPUT_LABEL[setup.output ?? definition.output];
	const suffix = labIsManual(setup) ? '' : MODE_SUFFIX[setup.mode];
	if (isAutomaticJobBuiltin(definition.builtin)) {
		return `${when}, ${definition.name} runs in the background.${suffix}`;
	}
	return `${when}, ${definition.name} runs ${runsIn} and will ${output}.${suffix}`;
}
