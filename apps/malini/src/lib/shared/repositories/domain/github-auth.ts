export type GitHubAuthStatus = Readonly<{
	authenticated: boolean;
	installed: boolean;
	login: string | null;
	host: string;
	message: string | null;
}>;

export type RepositoryImportSource =
	Readonly<{ kind: 'local-folder'; path: string }> | Readonly<{ kind: 'clone-url'; url: string }>;

export const GITHUB_AUTH_REQUIRED_MESSAGE =
	'GitHub CLI is not signed in. Run `gh auth login` in a terminal, then try again.';

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

export function isDuplicateRepositoryError(error: unknown): boolean {
	const text =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: JSON.stringify(error);
	return /already imported|already connected/iu.test(text);
}
