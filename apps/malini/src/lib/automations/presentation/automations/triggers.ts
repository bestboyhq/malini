import {
	mergedInRepository,
	SCHEDULE_CADENCES,
	scheduleCadenceLabel,
	schedulePlaceName,
	type ScheduleCadence,
	type SchedulePlace,
} from '$contract/automation-trigger';
import {
	isOneShotAutomationBuiltin,
	type AutomationBuiltin,
	type AutomationDefinitionRecord,
	type AutomationRunMode,
	type AutomationRunsIn,
} from '$contract/automations';
import type { IconName } from '$hyper-ui/icons';
import {
	githubOwnerFromFullName,
	projectFullName,
	projectsQuery,
} from '$shared/repositories/repositories.api';
import { isRunnableAutomation } from '$lib/automations/domain/builtin-automations';
import { scheduleOf } from '$lib/automations/domain/schedule';
import { BUILTIN_WHEN, automationWhenDetail } from '../automation-definition-copy';

export type TriggerGroup =
	'You' | 'Schedule' | 'Shipping' | 'Workstreams' | 'Chats' | 'Automations' | 'Malini';

export type Trigger = Readonly<{
	id: string;
	when: string | null;
	group: TriggerGroup;
	label: string;
	detail: string;
	icon: IconName;
}>;

export type TriggerLook = Readonly<{ label: string; icon: IconName; group?: TriggerGroup }>;

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
	'Schedule',
	'Shipping',
	'Workstreams',
	'Chats',
	'Automations',
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
		detail: 'Shipping stops and waits for you',
		icon: 'shield-alert',
	},
	{
		id: 'workstream-created',
		when: 'on repositories:workstream-created',
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
		id: 'merge-conflicted',
		when: 'on repositories:workstream-merge-conflicted',
		group: 'Workstreams',
		label: 'A merge stops on conflicts',
		detail: 'Merging the base branch into a workstream left conflicts',
		icon: 'swap',
	},
	{
		id: 'base-overlapped',
		when: 'on repositories:workstream-base-overlapped',
		group: 'Workstreams',
		label: 'Main changes a file a workstream changed',
		detail: 'Merging main would conflict, or both sides changed the same file',
		icon: 'branch',
	},
	{
		id: 'base-conflicted',
		when: 'on repositories:workstream-base-overlapped where conflicts is true',
		group: 'Workstreams',
		label: 'Main conflicts with a workstream',
		detail: 'Merging main into it would stop on conflicts',
		icon: 'swap',
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
		id: 'automation-failed',
		when: 'on automations:run-changed where run.status is failed',
		group: 'Automations',
		label: 'An automation fails',
		detail: 'Any automation run ends as failed',
		icon: 'close',
	},
	{
		id: 'automation-needs-you',
		when: 'on automations:run-changed where run.status is needs-you',
		group: 'Automations',
		label: 'An automation needs you',
		detail: 'An automation run stops and waits for you',
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

const BUILTIN_TRIGGER_ICONS: Readonly<Partial<Record<AutomationBuiltin, IconName>>> = {
	'name-chats': 'chat',
	'name-services': 'terminal',
	'fix-checks': 'pr-failed',
	'address-review': 'pr-open',
	'check-compatibility': 'sparkles',
	reconcile: 'route',
};

export const RUN_MODES: readonly Readonly<{
	value: AutomationRunMode;
	label: string;
	hint: string;
}>[] = [
	{ value: 'off', label: 'Off', hint: 'Never starts on its own' },
	{ value: 'ask', label: 'Ask me first', hint: 'Each run waits for your yes' },
	{ value: 'auto', label: 'On its own', hint: 'Runs as soon as it fires' },
];

export const SCHEDULE_ENTRY = {
	label: 'On a schedule',
	detail: 'Every day, every weekday or once a week',
	words: 'daily weekly routine morning evening time clock',
} as const;

export const SCHEDULE_CADENCE_OPTIONS: readonly Readonly<{
	value: ScheduleCadence;
	label: string;
}>[] = SCHEDULE_CADENCES.map((cadence) => ({
	value: cadence,
	label: scheduleCadenceLabel(cadence),
}));

export const SCHEDULE_RUNS_IN_HINT = 'Its own chat or workstream there, kept between runs.';

export const EVENT_RUNS_IN_OPTIONS: readonly Readonly<{
	value: AutomationRunsIn;
	label: string;
}>[] = [
	{ value: 'workstream', label: 'The workstream it fires in' },
	{ value: 'new-workstream', label: 'A new workstream' },
];

const RUNS_IN_PHRASE: Readonly<Record<AutomationRunsIn, string>> = {
	workstream: 'in the workstream it fires in',
	'new-workstream': 'in a new workstream',
};

const MANUAL_RUNS_IN_PHRASE: Readonly<Record<AutomationRunsIn, string>> = {
	workstream: 'in the workstream you pick',
	'new-workstream': 'in a new workstream',
};

const MODE_SUFFIX: Readonly<Record<AutomationRunMode, string>> = {
	off: ' It is off for now.',
	ask: ' It asks you first.',
	auto: '',
};

const THEN_FIRST: readonly AutomationBuiltin[] = ['open-draft', 'merge'];

export const UPDATE_FROM_MAIN_THEN =
	'Resolve conflicts, on its trigger, when the merge stops on conflicts';

export function triggerById(id: string): Trigger {
	return TRIGGERS.find((trigger) => trigger.id === id) ?? MANUAL_TRIGGER;
}

export function triggerFor(when: string | null): Trigger {
	if (when === null) return MANUAL_TRIGGER;
	return (
		TRIGGERS.find((trigger) => trigger.when === when) ??
		scheduledTrigger(when) ??
		mergedInTrigger(when) ??
		customTrigger(when)
	);
}

export function schedulePlaces(fullNames: readonly string[]): readonly SchedulePlace[] {
	const repositories = fullNames
		.filter((name) => githubOwnerFromFullName(name) !== null)
		.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
	const owners = [...new Set(repositories.map((name) => githubOwnerFromFullName(name) ?? ''))];
	return [
		{ kind: 'home' },
		...owners.flatMap((owner): SchedulePlace[] => [
			{ kind: 'owner', owner },
			...repositories
				.filter((name) => githubOwnerFromFullName(name) === owner)
				.map((repository): SchedulePlace => ({ kind: 'repository', repository })),
		]),
	];
}

export function schedulePlaceValue(place: SchedulePlace): string {
	return place.kind === 'home' ? '' : schedulePlaceName(place);
}

export function scheduleRunsIn(place: SchedulePlace): string {
	if (place.kind === 'home') return 'in its own chat at Home';
	return place.kind === 'owner'
		? `in its own chat in ${place.owner}`
		: `in its own workstream of ${place.repository}`;
}

export function builtinTrigger(
	automation: Pick<AutomationDefinitionRecord, 'builtin'>,
): TriggerLook | null {
	if (automation.builtin === null) return null;
	const icon = BUILTIN_TRIGGER_ICONS[automation.builtin];
	return icon ? { label: BUILTIN_WHEN[automation.builtin], icon } : null;
}

export function automationTriggerLook(
	automation: Pick<AutomationDefinitionRecord, 'builtin' | 'trigger'>,
): TriggerLook {
	return builtinTrigger(automation) ?? triggerFor(automation.trigger?.when ?? null);
}

export function runModeLabel(mode: AutomationRunMode): string {
	return RUN_MODES.find((option) => option.value === mode)?.label ?? mode;
}

export function runModeHint(mode: AutomationRunMode): string {
	return RUN_MODES.find((option) => option.value === mode)?.hint ?? '';
}

export function thenChoices(
	automations: readonly AutomationDefinitionRecord[],
	selfId: string | null,
): readonly Readonly<{ value: string; label: string }>[] {
	return automations
		.filter((automation) => automation.id !== selfId && isRunnableAutomation(automation))
		.sort((left, right) => thenRank(left) - thenRank(right) || left.name.localeCompare(right.name))
		.map((automation) => ({ value: automation.id, label: automation.name }));
}

function thenRank(automation: Pick<AutomationDefinitionRecord, 'builtin'>): number {
	const rank = automation.builtin === null ? -1 : THEN_FIRST.indexOf(automation.builtin);
	return rank === -1 ? THEN_FIRST.length : rank;
}

export function whenClause(look: TriggerLook): string {
	if (look.label === MANUAL_TRIGGER.label || look.group === 'Schedule') return look.label;
	const lead = look.label.startsWith('Malini')
		? look.label.charAt(0)
		: look.label.charAt(0).toLowerCase();
	return `When ${lead}${look.label.slice(1)}`;
}

export function automationSentence(
	automation: AutomationDefinitionRecord,
	thenName: string | null,
): string {
	if (builtinTrigger(automation) !== null) {
		return isOneShotAutomationBuiltin(automation.builtin)
			? `${whenClause(automationTriggerLook(automation))}, ${automation.name} runs in the background.`
			: automationWhenDetail(automation);
	}
	const { trigger } = automation;
	const schedule = scheduleOf(trigger?.when);
	const when = whenClause(automationTriggerLook(automation));
	const runsIn = schedule
		? scheduleRunsIn(schedule.place)
		: (trigger === null ? MANUAL_RUNS_IN_PHRASE : RUNS_IN_PHRASE)[automation.runsIn];
	const then = thenName === null ? '' : ` and then runs ${thenName}`;
	const suffix = trigger === null ? '' : MODE_SUFFIX[trigger.mode];
	return `${when}, ${automation.name} runs ${runsIn}${then}.${suffix}`;
}

function scheduledTrigger(when: string): Trigger | null {
	const schedule = scheduleOf(when);
	if (schedule === null) return null;
	return {
		id: when,
		when,
		group: 'Schedule',
		label: schedule.description,
		detail: `Runs ${scheduleRunsIn(schedule.place)}`,
		icon: 'clock',
	};
}

function mergedInTrigger(when: string): Trigger | null {
	const repositoryId = mergedInRepository(when);
	if (repositoryId === null) return null;
	return {
		id: when,
		when,
		group: 'Shipping',
		label: `A pull request merges in ${repositoryLabel(repositoryId)}`,
		detail: 'Malini merged a pull request it shipped there',
		icon: 'pr-merged',
	};
}

function repositoryLabel(repositoryId: string): string {
	const project = projectsQuery.data.find(({ id }) => id === repositoryId);
	return (project && projectFullName(project)) ?? 'this repository';
}

function customTrigger(when: string): Trigger {
	return {
		id: when,
		when,
		group: 'Malini',
		label: when.replace(/^on\s+/u, ''),
		detail: 'A Malini event',
		icon: 'signal',
	};
}
