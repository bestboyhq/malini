import type {
	AutomationBuiltin,
	AutomationDefinitionRecord,
	AutomationRunsIn,
} from '$contract/automations';

export const AUTOMATION_RUNS_IN_OPTIONS: readonly Readonly<{
	value: AutomationRunsIn;
	label: string;
}>[] = [
	{ value: 'workstream', label: 'The workstream you pick' },
	{ value: 'new-workstream', label: 'A new workstream' },
];

export const BUILTIN_WHEN: Readonly<Record<AutomationBuiltin, string>> = {
	'name-chats': 'You start a chat',
	'name-services': 'An agent leaves a command running',
	'fix-checks': 'Checks fail while shipping',
	'update-from-main': 'Main changes a file a workstream changed',
	'resolve-conflicts': 'A merge stops on conflicts',
	'address-review': 'A review asks for changes',
	'check-compatibility': 'Malini updates and its events change',
	'update-docs': 'When you run it, in a new workstream',
	'open-draft': 'When you run it, or after another automation',
	merge: 'When you run it, or after another automation',
	reconcile: 'An event no trigger handles',
	'suggest-automations': 'Your first ask after a merge',
	'capture-brain': 'A workstream is archived',
	'write-brain-notes': 'Every Sunday at 18:00',
};

const BUILTIN_WHEN_DETAIL: Readonly<Record<AutomationBuiltin, string>> = {
	'name-chats':
		'Runs on its own when you send a message in a chat with no name yet, and again when that turn ends, with the reply. It names the chat in three words at most, and the workstream while it is still New workstream.',
	'name-services':
		'Runs on its own when an agent leaves a command running in the background. It names what keeps running in the sidebar.',
	'fix-checks':
		'Malini runs it when checks fail on a pull request it is shipping. Run it yourself from any chat with /.',
	'update-from-main':
		'Its trigger runs it when main conflicts with a workstream or changes a file that workstream changed too, or, set to Always, whenever main moves past a workstream worked in this week, once no agent or service runs there and its changes are committed. A workstream with no commits of its own fast-forwards instead, in every mode. Malini also runs it before a scheduled automation works in its workstream. Run it yourself from any chat with /.',
	'resolve-conflicts':
		'Its trigger runs it when a merge stops on conflicts in any workstream, whoever started that merge: Merge, Update from main or you. With it off, Merge still runs it for the branch it merges. Run it yourself from any chat with /.',
	'address-review':
		'Its trigger runs it when a review asks for changes on a pull request. It answers each requested change, and Shipping commits and pushes its changes to the branch. It never merges. With it off, Merge still runs it for the pull request it merges. Run it yourself from any chat with /.',
	'check-compatibility':
		'Runs on its own after Malini updates and its events change, to repair the automations that rely on them. Run it yourself from any chat with / to check them all.',
	'update-docs':
		'Run it from any chat with /, give it a trigger, or make it the Then of another automation. It updates the docs in a new workstream, and then Open draft opens a draft PR.',
	'open-draft':
		'Run it from any chat with /, give it a trigger, or make it the Then of another automation. It commits the changes, pushes the branch and opens a draft PR.',
	merge:
		'Run it from any chat with /, give it a trigger, or make it the Then of another automation. It queues the pull request to merge.',
	reconcile:
		"Runs on its own when an event no automation's trigger handles may need a hand: a turn ends in a workstream a chat started, an automation a chat ran finishes or fails, or a merge stops on conflicts. When something already takes the work, Malini records that it does nothing, and why. Otherwise it lists what it could do, the model picks one, and Malini checks the pick before it acts. When the model cannot answer, Malini wakes the chat that asked for the work, or asks you.",
	'suggest-automations':
		'Runs on its own when the first thing you type after a pull request merges may match what you typed after an earlier merge in that repository. When it does, a suggested automation shows under the reply. Nothing runs until you save it.',
	'capture-brain':
		'Its trigger runs it when a workstream is archived, and Malini catches up on Home chats once a day. It appends what you typed and each Outcome line to log/ in the brain, with secrets taken out, and never rewrites it. No model runs. Deleting a workstream captures nothing.',
	'write-brain-notes':
		'Its trigger runs it in the brain every Sunday at 18:00. It reads the log, rewrites notes/, and sees only the brain: no chats, no attachments, no internet. Malini commits and pushes what it writes. Run it yourself from any chat with /.',
};

const RUNS_IN_WHEN: Readonly<Record<AutomationRunsIn, string>> = {
	workstream: 'When you run it',
	'new-workstream': 'When you run it, in a new workstream',
};

export function automationWhen(
	definition: Pick<AutomationDefinitionRecord, 'runsIn' | 'builtin'>,
): string {
	return definition.builtin === null
		? RUNS_IN_WHEN[definition.runsIn]
		: BUILTIN_WHEN[definition.builtin];
}

export function automationWhenDetail(
	definition: Pick<AutomationDefinitionRecord, 'builtin'>,
): string {
	return definition.builtin === null
		? 'Run it from any chat with /, from here, or as the Then of another automation.'
		: BUILTIN_WHEN_DETAIL[definition.builtin];
}

export function instructionsPreview(instructions: string): string {
	const [firstParagraph = ''] = instructions.trim().split(/\n\s*\n/u);
	return firstParagraph.replaceAll(/\s+/gu, ' ');
}
