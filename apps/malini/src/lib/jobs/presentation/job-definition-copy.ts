import type { AgentReasoningEffort } from '$contract/agent';
import type { JobBuiltin, JobDefinitionRecord, JobOutput, JobRunsIn } from '$contract/jobs';

export const JOB_RUNS_IN_OPTIONS: readonly Readonly<{ value: JobRunsIn; label: string }>[] = [
	{ value: 'workstream', label: 'The workstream you pick' },
	{ value: 'new-workstream', label: 'A new workstream' },
];

export const JOB_OUTPUT_OPTIONS: readonly Readonly<{ value: JobOutput; label: string }>[] = [
	{ value: 'none', label: 'Leave the changes to you' },
	{ value: 'draft', label: 'Open a draft PR' },
	{ value: 'merge', label: 'Queue the merge' },
];

const BUILTIN_WHEN: Readonly<Record<JobBuiltin, string>> = {
	'name-chats': 'Your first message in a chat',
	'name-services': 'A command an agent leaves running',
	'fix-checks': 'Checks fail while shipping',
	'update-from-main': 'The branch falls behind while shipping',
	'address-review': 'A bot reviews while shipping',
	'check-compatibility': 'Malini updates and its events change',
	'update-docs': 'When you run it, in a new workstream',
};

const BUILTIN_WHEN_DETAIL: Readonly<Record<JobBuiltin, string>> = {
	'name-chats':
		'Runs on its own when you send the first message in a chat. It names the chat, and the workstream on its first chat.',
	'name-services':
		'Runs on its own when an agent leaves a command running in the background. It names what keeps running in the sidebar.',
	'fix-checks':
		'The merge queue runs it when checks fail on a pull request it is shipping. Run it yourself from any chat with /.',
	'update-from-main':
		'The merge queue runs it when a branch it is shipping falls behind its base. Run it yourself from any chat with /.',
	'address-review':
		'The merge queue runs it when a bot reviews a pull request it is shipping. Run it yourself from any chat with /.',
	'check-compatibility':
		'Runs on its own after Malini updates and its events change, to repair the jobs and routines that rely on them. Run it yourself from any chat with / to check them all.',
	'update-docs':
		'Run it from any chat with / or as a step in a routine. It updates the docs in a new workstream and opens a draft PR.',
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
		? 'Run it from any chat with /, from here, or as a step in a routine.'
		: BUILTIN_WHEN_DETAIL[definition.builtin];
}

export function instructionsPreview(instructions: string): string {
	const [firstParagraph = ''] = instructions.trim().split(/\n\s*\n/u);
	return firstParagraph.replaceAll(/\s+/gu, ' ');
}
