import type { CheckoutFinding, CheckoutRestore } from '$contract/repositories';

type Line = Readonly<{ label: string; detail: string }>;

export type CheckoutActionKind = 'repair' | 'sign-in' | 'ask-agent' | 'reveal' | 'report';

export type CheckoutAction = Readonly<{ kind: CheckoutActionKind; label: string }>;

export type CheckoutFindingCopy = Readonly<{
	broken: Line;
	busy: Line;
	action: CheckoutAction;
	secondaryAction: CheckoutAction | null;
	waiting: string;
}>;

const YOUR_FILES_STAY = 'Your files stay';
const fixedBy = (label: string): CheckoutAction => ({ kind: 'repair', label });
const TRY_AGAIN = fixedBy('Try again');
const GIT_READS_AGAIN = 'Sends once git reads it again';

const repaired = (busy: string, failed: Line): CheckoutFindingCopy => ({
	busy: { label: busy, detail: YOUR_FILES_STAY },
	broken: failed,
	action: TRY_AGAIN,
	secondaryAction: null,
	waiting: GIT_READS_AGAIN,
});

export const CLONING_FINDINGS: ReadonlySet<CheckoutFinding> = new Set([
	'base-repository-missing',
	'github-signed-out',
	'remote-missing',
	'checkouts-folder-missing',
]);

const cloning = (repository: string): Line => ({
	label: `Cloning ${repository} again`,
	detail: 'Its copy on this Mac is gone',
});

const gitMissing: CheckoutFindingCopy = {
	busy: { label: 'Waiting for Apple’s installer', detail: 'Finish it in Apple’s window' },
	broken: { label: 'Git is not on this Mac', detail: 'Apple’s Command Line Tools add it' },
	action: fixedBy('Install'),
	secondaryAction: null,
	waiting: 'Sends once git is installed',
};

export function checkoutFindingCopy(
	finding: CheckoutFinding,
	repository: string,
): CheckoutFindingCopy {
	switch (finding) {
		case 'folder-missing':
			return {
				...repaired('Making the folder again', {
					label: 'The workstream folder is gone',
					detail: 'Making it again failed',
				}),
				busy: { label: 'Making the folder again', detail: 'From its branch' },
				waiting: 'Sends once the folder is back',
			};
		case 'git-link-missing':
			return repaired('Linking the folder to git', {
				label: 'The folder lost its git link',
				detail: 'Linking it again failed',
			});
		case 'admin-missing':
			return repaired('Registering the folder with git', {
				label: 'Git lost track of this folder',
				detail: 'Registering it again failed',
			});
		case 'base-repository-missing':
			return {
				busy: cloning(repository),
				broken: { label: `Cannot clone ${repository} again`, detail: 'GitHub does not answer' },
				action: TRY_AGAIN,
				secondaryAction: null,
				waiting: 'Sends once the clone is back',
			};
		case 'github-signed-out':
			return {
				busy: cloning(repository),
				broken: { label: `Cannot clone ${repository} again`, detail: 'GitHub is signed out' },
				action: { kind: 'sign-in', label: 'Sign in to GitHub' },
				secondaryAction: null,
				waiting: 'Sends once you sign in to GitHub',
			};
		case 'remote-missing':
			return {
				busy: cloning(repository),
				broken: { label: `GitHub has no ${repository}`, detail: 'Deleted, or not yours to see' },
				action: { kind: 'sign-in', label: 'Use another account' },
				secondaryAction: { kind: 'reveal', label: 'Show in Finder' },
				waiting: 'Sends once GitHub finds it',
			};
		case 'checkouts-folder-missing':
			return {
				busy: {
					label: 'Making the workstreams folder again',
					detail: 'Each workstream from its branch',
				},
				broken: { label: 'The workstreams folder is gone', detail: 'Moved or deleted' },
				action: fixedBy('Make it again'),
				secondaryAction: null,
				waiting: 'Sends once the folder is back',
			};
		case 'stale-lock':
			return repaired('Removing a stale git lock', {
				label: 'A stale git lock is in the way',
				detail: 'Removing it failed',
			});
		case 'index-corrupt':
			return repaired('Rebuilding the git index', {
				label: 'The git index is damaged',
				detail: 'Rebuilding it failed',
			});
		case 'head-invalid':
			return repaired('Pointing the folder at its branch', {
				label: 'Git lost the current commit',
				detail: 'Pointing it back failed',
			});
		case 'dubious-ownership':
			return {
				busy: { label: 'Trusting this folder', detail: 'Adds it to your git config' },
				broken: { label: 'Git does not trust this folder', detail: 'Another user owns it' },
				action: fixedBy('Trust this folder'),
				secondaryAction: null,
				waiting: 'Sends once git trusts this folder',
			};
		case 'git-unavailable':
		case 'developer-tools-missing':
			return gitMissing;
		case 'xcode-license':
			return {
				busy: { label: 'Accepting the Xcode license', detail: 'macOS asks for your password' },
				broken: {
					label: 'Git waits for the Xcode license',
					detail: 'Accepting it takes your password',
				},
				action: fixedBy('Accept license'),
				secondaryAction: null,
				waiting: 'Sends once the license is accepted',
			};
		case 'permission-denied':
			return {
				busy: { label: 'Waiting for macOS access', detail: 'Turn Malini on in Full Disk Access' },
				broken: { label: 'macOS blocks this folder', detail: 'Malini needs Full Disk Access' },
				action: fixedBy('Open Privacy settings'),
				secondaryAction: null,
				waiting: 'Sends once Malini has access',
			};
		case 'disk-full':
			return {
				busy: { label: 'Waiting for free space', detail: 'Goes on once there is room' },
				broken: { label: 'The disk is full', detail: 'Git needs room to work' },
				action: fixedBy('Open Storage settings'),
				secondaryAction: null,
				waiting: 'Sends once there is space',
			};
		case 'unknown':
			return {
				busy: { label: 'An agent is fixing the checkout', detail: 'In this folder' },
				broken: { label: 'Git cannot read this checkout', detail: 'Git gave no reason' },
				action: { kind: 'ask-agent', label: 'Ask an agent' },
				secondaryAction: { kind: 'report', label: 'Report' },
				waiting: 'Sends once the checkout works',
			};
	}
}

const RESTORE_DETAILS: Readonly<Record<CheckoutRestore, string>> = {
	'branch-from-github': 'Branch back from GitHub',
	'commits-as-edits': `${YOUR_FILES_STAY}. Commits are edits now`,
	'nothing-lost': 'Nothing lost',
};

export function checkoutRestoreCopy(restore: CheckoutRestore, repository: string): Line {
	return { label: `Cloned ${repository} again`, detail: RESTORE_DETAILS[restore] };
}
