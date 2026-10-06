import { basename } from 'node:path';

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
	);
}

export function errorCode(error: unknown): string | undefined {
	return isErrnoException(error) ? error.code : undefined;
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const WORKSTREAM_FOLDER_MISSING = "This workstream's folder is missing.";

export type GitErrorKind =
	| 'auth-failed'
	| 'repository-not-found'
	| 'unsafe-path'
	| 'not-a-repo'
	| 'branch-exists'
	| 'worktree-busy'
	| 'output-too-large'
	| 'git-unavailable'
	| 'git'
	| 'io';

export type GitCredentialOffer = 'sent' | 'none';

export function credentialOfferFromToken(token: string | null | undefined): GitCredentialOffer {
	return token && token.trim().length > 0 ? 'sent' : 'none';
}

function authFailureMessage(credentials: GitCredentialOffer | undefined): string {
	return credentials === 'none'
		? 'GitHub needs you to sign in. Run `gh auth login` and try again.'
		: 'GitHub rejected the credentials. Run `gh auth login` and try again.';
}

export interface GitCommandFailure {
	readonly args: readonly string[];
	readonly exitCode: number | null;
	readonly signal: string | null;
	readonly output: string;
	readonly outputTruncated?: boolean;
	readonly vanishedCheckout?: string | null;
}

export interface GitFailureVerdict {
	readonly kind: GitErrorKind;
	readonly message: string;
	readonly code?: string;
}

interface GitErrorExtra {
	readonly detail?: string | undefined;
	readonly credentials?: GitCredentialOffer | undefined;
	readonly code?: string | undefined;
	readonly exitCode?: number | null | undefined;
	readonly cause?: unknown;
}

export class GitError extends Error {
	readonly kind: GitErrorKind;
	readonly detail: string | undefined;
	readonly credentials: GitCredentialOffer | undefined;
	readonly code: string | undefined;
	readonly exitCode: number | null;

	constructor(kind: GitErrorKind, message: string, extra: GitErrorExtra = {}) {
		super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
		this.name = 'GitError';
		this.kind = kind;
		this.detail = extra.detail;
		this.credentials = extra.credentials;
		this.code = extra.code;
		this.exitCode = extra.exitCode ?? null;
	}

	static commandFailed(failure: GitCommandFailure): GitError {
		const verdict = failure.vanishedCheckout
			? folderMissing(failure.vanishedCheckout)
			: gitFailureVerdict(failure.output);
		return new GitError(verdict.kind, verdict.message, {
			detail: failure.output,
			code: verdict.code,
			exitCode: failure.exitCode,
			cause: new Error(gitCommandTranscript(failure)),
		});
	}

	static authFailed(detail: string, credentials?: GitCredentialOffer): GitError {
		return new GitError('auth-failed', authFailureMessage(credentials), { detail, credentials });
	}

	static unsafePath(detail: string): GitError {
		return new GitError('unsafe-path', `unsafe path: ${detail}`);
	}

	static notARepo(): GitError {
		return new GitError('not-a-repo', 'not a git repository');
	}

	static branchExists(branch: string): GitError {
		return new GitError('branch-exists', `branch already exists: ${branch}`, { detail: branch });
	}

	static worktreeBusy(detail: string): GitError {
		return new GitError('worktree-busy', `worktree busy: ${detail}`);
	}

	static outputTooLarge(operation: string, maxBytes: number): GitError {
		return new GitError(
			'output-too-large',
			`${operation} output is over ${byteSize(maxBytes)}, too large to read safely`,
		);
	}

	static gitUnavailable(detail: string): GitError {
		return new GitError('git-unavailable', `git unavailable: ${detail}`);
	}

	static git(detail: string): GitError {
		return new GitError('git', `git error: ${detail}`, { detail });
	}

	static checkoutMissing(workstreamId: string): GitError {
		return new GitError('io', WORKSTREAM_FOLDER_MISSING, {
			detail: `repository checkout \`${workstreamId}\` not found`,
			code: 'ENOENT',
		});
	}

	static io(detail: string, code?: string): GitError {
		return new GitError('io', `io error: ${detail}`, { detail, ...(code ? { code } : {}) });
	}

	static fromNodeError(error: unknown): GitError {
		if (error instanceof GitError) return error;
		if (isErrnoException(error)) {
			return GitError.io(error.message, error.code);
		}
		return GitError.io(describeError(error));
	}
}

export function isGitError(error: unknown, kind?: GitErrorKind): error is GitError {
	return error instanceof GitError && (kind === undefined || error.kind === kind);
}

export function isNotFoundError(error: unknown): boolean {
	return isGitError(error, 'io') && error.code === 'ENOENT';
}

export function attributeCredentials(error: GitError, githubToken: string | null): GitError {
	if (error.kind !== 'auth-failed') return error;
	const credentials = credentialOfferFromToken(githubToken);
	return new GitError('auth-failed', authFailureMessage(credentials), {
		detail: error.detail,
		credentials,
		exitCode: error.exitCode,
		cause: error.cause,
	});
}

export function failureOutput(error: unknown): string {
	return error instanceof GitError ? (error.detail ?? error.message) : describeError(error);
}

const AUTH_FAILURE =
	/authentication failed|could not read (?:username|password)|requested url returned error: 40[13]\b|permission to \S+ denied|invalid username or (?:password|token)|permission denied \(publickey/iu;
const REPOSITORY_NOT_FOUND = /repository not found|repository '[^']*' not found/iu;
const REMOTE_UNREACHABLE =
	/could not resolve (?:host|hostname|proxy)|failed to connect to|couldn't connect to server|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|temporary failure in name resolution/iu;
const REMOTE_HAS_NEW_COMMITS =
	/\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)|updates were rejected because the (?:remote|tip)/iu;
const MERGE_CONFLICT = /^CONFLICT \(/mu;
const MERGE_CONFLICT_PATH = /^CONFLICT \([^)]*\): Merge conflict in (.+)$/gmu;
const INDEX_LOCKED = /index\.lock'?: File exists/u;
const FOLDER_GONE = /cannot change to '([^']+)': No such file or directory/u;
const LISTED_CONFLICT_PATHS = 3;

function folderMissing(folder: string): GitFailureVerdict {
	return { kind: 'io', message: `The folder ${basename(folder)} is missing.`, code: 'ENOENT' };
}

export function gitFailureVerdict(output: string): GitFailureVerdict {
	const gone = FOLDER_GONE.exec(output)?.[1];
	if (gone) return folderMissing(gone);
	if (AUTH_FAILURE.test(output)) {
		return { kind: 'auth-failed', message: authFailureMessage(undefined) };
	}
	if (REPOSITORY_NOT_FOUND.test(output)) {
		return {
			kind: 'repository-not-found',
			message: `GitHub couldn't find ${remoteName(output)}, or this account can't see it. Check the URL, or run \`gh auth login\` as an account that can.`,
		};
	}
	if (REMOTE_UNREACHABLE.test(output)) {
		return {
			kind: 'git',
			message: `Couldn't reach ${remoteHost(output)}. Check your connection and try again.`,
		};
	}
	if (REMOTE_HAS_NEW_COMMITS.test(output)) {
		return {
			kind: 'git',
			message: 'The remote branch has new commits. Update this branch and try again.',
		};
	}
	if (MERGE_CONFLICT.test(output)) {
		return {
			kind: 'git',
			message: `${mergeConflictSubject(output)}. Resolve the conflicts and try again.`,
		};
	}
	if (INDEX_LOCKED.test(output)) {
		return {
			kind: 'worktree-busy',
			message: 'Git is busy in this workstream (index.lock). Try again in a moment.',
		};
	}
	return { kind: 'git', message: gitVerdictLine(output) };
}

function remoteUrl(output: string): URL | null {
	const quoted = /(?:unable to access|repository) '([a-z][a-z0-9+.-]*:\/\/[^']+)'/iu.exec(output);
	if (!quoted?.[1]) return null;
	try {
		return new URL(quoted[1]);
	} catch {
		return null;
	}
}

function remoteHost(output: string): string {
	const named =
		remoteUrl(output)?.hostname ??
		/could not resolve host(?:name)?:? ([^\s:]+)/iu.exec(output)?.[1] ??
		/connect to host ([^\s:]+)/iu.exec(output)?.[1];
	return named && named.length > 0 ? named : 'the remote';
}

function remoteName(output: string): string {
	const path = remoteUrl(output)
		?.pathname.replace(/^\/+|\/+$/gu, '')
		.replace(/\.git$/u, '');
	return path ? path : 'the repository';
}

function mergeConflictSubject(output: string): string {
	const paths = [...output.matchAll(MERGE_CONFLICT_PATH)].flatMap((match) =>
		match[1] ? [match[1].trim()] : [],
	);
	if (paths.length === 0) return 'Merge conflict';
	const listed = paths.slice(0, LISTED_CONFLICT_PATHS).join(', ');
	const more = paths.length - LISTED_CONFLICT_PATHS;
	return more > 0 ? `Merge conflict in ${listed} and ${more} more` : `Merge conflict in ${listed}`;
}

function gitVerdictLine(output: string): string {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !/^hint:/iu.test(line));
	const verdict = lines.filter((line) => /^(?:fatal|error):/iu.test(line)).at(-1) ?? lines.at(-1);
	const cleaned = withoutAbsolutePaths(verdict?.replace(/^(?:fatal|error):\s*/iu, '') ?? '');
	return cleaned.length > 0 ? cleaned : 'Git stopped without giving a reason.';
}

function withoutAbsolutePaths(line: string): string {
	return line
		.replace(/'(\/[^']+)'/gu, (_, path: string) => `'${basename(path)}'`)
		.replace(/(?<![\w:/.~-])\/[^\s'",;]+/gu, (path) => basename(path));
}

const CREDENTIAL_CONFIG = /^((?:credential\b[^=]*|http\.[^=]*extraheader)=)(.+)$/iu;

function gitCommandTranscript(failure: GitCommandFailure): string {
	const command = failure.args
		.map((argument) => argument.replace(CREDENTIAL_CONFIG, '$1[redacted]'))
		.join(' ');
	const ending =
		failure.exitCode !== null
			? `exited with code ${failure.exitCode}`
			: failure.signal
				? `was stopped by ${failure.signal}`
				: 'exited without a code';
	const truncated = failure.outputTruncated ? '\n[output truncated]' : '';
	return `git ${command} ${ending}\n${failure.output.trim()}${truncated}`;
}

const GH_AUTH_REQUIRED_PATTERN =
	/not logged in|not signed in|gh auth login|authentication required/iu;

export type GhErrorKind = 'not-installed' | 'auth-required' | 'no-pull-request' | 'failed';

function firstMeaningfulGhLine(stderr: string): string {
	const lines = stderr
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const verdict =
		lines.find((line) => /^(fatal|error|x |gh:)/iu.test(line)) ?? lines[lines.length - 1];
	return (verdict ?? '').replace(/^(fatal|error|gh):\s*/iu, '').trim();
}

export class GhError extends Error {
	readonly kind: GhErrorKind;
	readonly code: number | null;
	readonly stderr: string;

	constructor(
		kind: GhErrorKind,
		message: string,
		extra: { code?: number | null; stderr?: string } = {},
	) {
		super(message);
		this.name = 'GhError';
		this.kind = kind;
		this.code = extra.code ?? null;
		this.stderr = extra.stderr ?? '';
	}

	static notInstalled(): GhError {
		return new GhError(
			'not-installed',
			'GitHub CLI (`gh`) was not found. Install it from https://cli.github.com, then run `gh auth login`.',
			{ code: null },
		);
	}

	static fromStderr(stderr: string, code: number): GhError {
		const detail = firstMeaningfulGhLine(stderr) || stderr.trim() || `gh exited with code ${code}`;
		if (GH_AUTH_REQUIRED_PATTERN.test(stderr)) {
			return new GhError('auth-required', detail, { code, stderr });
		}
		if (/no pull requests found|no open pull requests/iu.test(stderr)) {
			return new GhError('no-pull-request', detail, { code, stderr });
		}
		return new GhError('failed', detail, { code, stderr });
	}
}

export function isGhError(error: unknown, kind?: GhErrorKind): error is GhError {
	return error instanceof GhError && (kind === undefined || error.kind === kind);
}

export class DbInvariantError extends Error {
	readonly detail: string;

	constructor(detail: string) {
		super(`db invariant failed: ${detail}`);
		this.name = 'DbInvariantError';
		this.detail = detail;
	}
}

export function invariant(detail: string): DbInvariantError {
	return new DbInvariantError(detail);
}

function byteSize(bytes: number): string {
	const megabytes = bytes / (1024 * 1024);
	return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}
