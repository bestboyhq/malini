import type { DefaultSwitch, UpdateFromMain } from '$lib/app/domain/automation-defaults';

export type DefaultSwitchCopy = Readonly<{
	key: DefaultSwitch;
	title: string;
	detail: string;
	off?: string;
}>;

export const DEFAULT_SWITCHES: readonly DefaultSwitchCopy[] = [
	{
		key: 'resolveConflicts',
		title: 'Resolve merge conflicts',
		detail: 'An agent merges main into the branch and fixes what clashes.',
		off: 'Off waits for you to press Merge.',
	},
	{
		key: 'addressReview',
		title: 'Address review comments',
		detail: 'An agent answers each requested change and pushes to the branch, never merges.',
		off: 'Off waits for you to press Merge.',
	},
	{
		key: 'brain',
		title: 'Keep a second brain',
		detail: 'Notes on what your chats taught you, in a private GitHub repository.',
	},
];

export function switchDetail({ detail, off }: DefaultSwitchCopy): string {
	return off ? `${detail} ${off}` : detail;
}

export const UPDATE_FROM_MAIN_LABELS: Readonly<Record<UpdateFromMain, string>> = {
	touches: 'Touches my files',
	always: 'Always',
	never: 'Never',
};

export const UPDATE_FROM_MAIN_DETAILS: Readonly<Record<UpdateFromMain, string>> = {
	touches: 'Merges main into a workstream when it touches your files. Never pushes.',
	always: 'Merges main into every workstream you worked in this week. Never pushes.',
	never: 'Leaves your commits alone until you press Merge.',
};

export const RECOMMENDED_UPDATE_FROM_MAIN = {
	title: 'Update from main when it touches your files',
	detail: 'Merges main into the workstream, locally. Never pushes.',
};

export const BRAIN_FINE_PRINT =
	'The log holds what you typed in archived chats, with secrets taken out. Notes are written from it. Both go to your private repository, and nowhere else.';
