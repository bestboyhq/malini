import type { AgentReasoningEffort } from '$contract/agent';
import type { JobBuiltin, JobDefinitionRecord, JobRunsIn } from '$contract/jobs';

export const JOB_RUNS_IN_OPTIONS: readonly Readonly<{ value: JobRunsIn; label: string }>[] = [
	{ value: 'workstream', label: 'The workstream you pick' },
	{ value: 'new-workstream', label: 'A new workstream' },
];

export const BUILTIN_WHEN: Readonly<Record<JobBuiltin, string>> = {
	'name-chats': 'You start a chat',
	'name-services': 'An agent leaves a command running',
	'fix-checks': 'Checks fail while shipping',
	'update-from-main': 'When you run it',
	'resolve-conflicts': 'A merge stops on conflicts',
	'address-review': 'A bot reviews while shipping',
	'check-compatibility': 'Malini updates and its events change',
	'update-docs': 'When you run it, in a new workstream',
	'open-draft': 'When you run it, or after another job',
	merge: 'When you run it, or after another job',
	reconcile: 'An event no trigger handles',
};

const BUILTIN_WHEN_DETAIL: Readonly<Record<JobBuiltin, string>> = {
	'name-chats':
		'Runs on its own when you send the first message in a chat. It names the chat, and the workstream on its first chat.',
	'name-services':
		'Runs on its own when an agent leaves a command running in the background. It names what keeps running in the sidebar.',
	'fix-checks':
		'Malini runs it when checks fail on a pull request it is shipping. Run it yourself from any chat with /.',
	'update-from-main':
		'Run it yourself from any chat with /. On its own, Malini runs it before a scheduled job works in its workstream, and merges main into a branch itself only while it merges that branch.',
	'resolve-conflicts':
		'Its trigger runs it when a merge stops on conflicts in any workstream, whoever started that merge: Merge, Update from main or you. With it off, Merge still runs it for the branch it merges. Run it yourself from any chat with /.',
	'address-review':
		'Malini runs it when a bot reviews a pull request it is shipping. Run it yourself from any chat with /.',
	'check-compatibility':
		'Runs on its own after Malini updates and its events change, to repair the jobs that rely on them. Run it yourself from any chat with / to check them all.',
	'update-docs':
		'Run it from any chat with /, give it a trigger, or make it the Then of another job. It updates the docs in a new workstream, and then Open draft opens a draft PR.',
	'open-draft':
		'Run it from any chat with /, give it a trigger, or make it the Then of another job. It commits the changes, pushes the branch and opens a draft PR.',
	merge:
		'Run it from any chat with /, give it a trigger, or make it the Then of another job. It queues the pull request to merge.',
	reconcile:
		"Runs on its own when an event no job's trigger handles may need a hand: a turn ends in a workstream a chat started, a job a chat ran finishes or fails, or a merge stops on conflicts. When something already takes the work, Malini records that it does nothing, and why. Otherwise it lists what it could do, the model picks one, and Malini checks the pick before it acts. When the model cannot answer, Malini wakes the chat that asked for the work, or asks you.",
};

const RUNS_IN_WHEN: Readonly<Record<JobRunsIn, string>> = {
	workstream: 'When you run it',
	'new-workstream': 'When you run it, in a new workstream',
};

export function effortLabel(effort: AgentReasoningEffort): string {
	if (effort === 'xhigh') return 'Extra high';
	return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

export function jobWhen(definition: Pick<JobDefinitionRecord, 'runsIn' | 'builtin'>): string {
	return definition.builtin === null
		? RUNS_IN_WHEN[definition.runsIn]
		: BUILTIN_WHEN[definition.builtin];
}

export function jobWhenDetail(definition: Pick<JobDefinitionRecord, 'builtin'>): string {
	return definition.builtin === null
		? 'Run it from any chat with /, from here, or as the Then of another job.'
		: BUILTIN_WHEN_DETAIL[definition.builtin];
}

export function instructionsPreview(instructions: string): string {
	const [firstParagraph = ''] = instructions.trim().split(/\n\s*\n/u);
	return firstParagraph.replaceAll(/\s+/gu, ' ');
}
