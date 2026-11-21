import type { CheckoutFinding } from '$contract/repositories';

type CheckoutFindingCopy = Readonly<{
	headline: string;
	repair?: string;
	instruction: string;
}>;

export const CHECKOUT_FINDING_COPY: Readonly<Record<CheckoutFinding, CheckoutFindingCopy>> = {
	'folder-missing': {
		headline: 'The folder of this workstream is gone',
		repair: 'Repair makes it again from its branch',
		instruction: 'Put the folder back, or archive this workstream',
	},
	'git-link-missing': {
		headline: 'This folder lost its link to git',
		repair: 'Repair links it again. Your files stay',
		instruction: 'Run git worktree repair in the repository',
	},
	'admin-missing': {
		headline: 'Git lost track of this checkout',
		repair: 'Repair registers it again. Your files stay',
		instruction: 'Run git worktree repair in the repository',
	},
	'base-repository-missing': {
		headline: 'The repository behind this checkout is gone',
		instruction: 'Put the repository folder back, or archive this workstream',
	},
	'stale-lock': {
		headline: 'A git command stopped and left its lock',
		repair: 'Repair removes the lock. Your files stay',
		instruction: 'Wait for the other git command to end',
	},
	'index-corrupt': {
		headline: 'The git index of this checkout is damaged',
		repair: 'Repair builds it again from the last commit. Your files stay',
		instruction: 'Run git reset in the folder. Your files stay',
	},
	'head-invalid': {
		headline: 'Git cannot tell which commit this checkout is on',
		repair: 'Repair points it back at its branch. Your files stay',
		instruction: 'Check out the branch of this workstream in the folder',
	},
	'dubious-ownership': {
		headline: 'Git does not trust the owner of this folder',
		instruction: 'Add the folder with git config --global --add safe.directory',
	},
	'git-unavailable': {
		headline: 'Git does not run on this Mac',
		instruction: 'Install git, then come back to Malini',
	},
	'developer-tools-missing': {
		headline: 'Git needs the Command Line Tools from Apple',
		instruction: 'Run xcode-select --install in Terminal, then come back to Malini',
	},
	'permission-denied': {
		headline: 'Malini cannot read or write this folder',
		instruction: 'Give your user read and write access to the folder in Finder',
	},
	'disk-full': {
		headline: 'The disk is full',
		instruction: 'Free some disk space, then come back to Malini',
	},
	unknown: {
		headline: 'Git cannot read this checkout',
		instruction: 'Run git status in the folder to see what git says',
	},
};
