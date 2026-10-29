export type GitHubAuthStatus = Readonly<{
	authenticated: boolean;
	installed: boolean;
	login: string | null;
	host: string;
	message: string | null;
}>;

export type GitHubSetupStatus = 'checking' | 'missing' | 'unknown' | 'signed-out' | 'ready';

export function githubSetupStatus(
	auth: GitHubAuthStatus | null,
	error: string | null,
): GitHubSetupStatus {
	if (auth === null) return error === null ? 'checking' : 'unknown';
	if (!auth.installed) return 'missing';
	return auth.authenticated ? 'ready' : 'signed-out';
}

export type GitHubDeviceCode = Readonly<{ userCode: string; verificationUri: string }>;

export type GitHubSignInOutcome = 'signed-in' | 'cancelled';

export type GitHubDeviceFlow = 'sign-in' | 'workflow-access';

export type GitHubSignInState =
	| Readonly<{ kind: 'idle' }>
	| Readonly<{ kind: 'starting'; flow: GitHubDeviceFlow }>
	| (Readonly<{ kind: 'waiting'; flow: GitHubDeviceFlow }> & GitHubDeviceCode)
	| Readonly<{ kind: 'confirming'; flow: GitHubDeviceFlow }>;

export type RepositoryImportSource =
	Readonly<{ kind: 'local-folder'; path: string }> | Readonly<{ kind: 'clone-url'; url: string }>;

export const GITHUB_AUTH_REQUIRED_MESSAGE =
	'GitHub is not signed in. Sign in to GitHub in Settings, then try again.';

export class GitHubAuthRequiredError extends Error {
	constructor(message: string = GITHUB_AUTH_REQUIRED_MESSAGE) {
		super(message);
		this.name = 'GitHubAuthRequiredError';
	}
}

const AUTH_REQUIRED_PATTERN = /not (?:signed|logged) in|gh auth login|GitHubAuthRequired/iu;

export function isGitHubAuthRequiredError(error: unknown): boolean {
	if (error instanceof GitHubAuthRequiredError) return true;
	const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	return AUTH_REQUIRED_PATTERN.test(text);
}
