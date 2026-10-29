import { describe, expect, it } from 'vitest';
import { githubFailure } from '$contract/github-failure';
import {
	attributeCredentials,
	GhError,
	GitError,
	gitFailureVerdict,
	isNotFoundError,
	remoteRefusal,
	workflowRefusal as workflowRefusalOf,
	type GitCommandFailure,
} from './errors';

const PROXY_UNREACHABLE =
	"fatal: unable to access 'https://github.com/e2e/hutch.git/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server\n";
const DNS_FAILURE =
	"fatal: unable to access 'https://github.com/e2e/hutch.git/': Could not resolve host: github.com\n";
const SSH_DNS_FAILURE =
	'ssh: Could not resolve hostname github.com: nodename nor servname provided, or not known\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n';
const FORBIDDEN =
	"remote: Permission to e2e/hutch.git denied to e2e-user.\nfatal: unable to access 'https://github.com/e2e/hutch.git/': The requested URL returned error: 403\n";
const UNAUTHORIZED =
	"remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/e2e/hutch.git/'\n";
const NO_CREDENTIALS =
	"fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
const NOT_FOUND =
	"remote: Repository not found.\nfatal: repository 'https://github.com/e2e/hutch.git/' not found\n";
const FETCH_FIRST = [
	'To https://github.com/e2e/hutch.git',
	' ! [rejected]        malini/e2e-dbg -> malini/e2e-dbg (fetch first)',
	"error: failed to push some refs to 'https://github.com/e2e/hutch.git'",
	'hint: Updates were rejected because the remote contains work that you do not',
	'hint: have locally. This is usually caused by another repository pushing to',
	'',
].join('\n');
const NON_FAST_FORWARD = [
	'To https://github.com/e2e/hutch.git',
	' ! [rejected]        malini/e2e-dbg -> malini/e2e-dbg (non-fast-forward)',
	"error: failed to push some refs to 'https://github.com/e2e/hutch.git'",
	'hint: Updates were rejected because the tip of your current branch is behind',
	'',
].join('\n');
const MERGE_CONFLICT = [
	'Auto-merging src/app.ts',
	'CONFLICT (content): Merge conflict in src/app.ts',
	'Auto-merging README.md',
	'CONFLICT (content): Merge conflict in README.md',
	'Automatic merge failed; fix conflicts and then commit the result.',
	'',
].join('\n');
const INDEX_LOCKED = [
	"fatal: Unable to create '/private/var/folders/vw/T/malini-e2e-QnpA8f/user-data/workstreams/e2e-dbg/.git/index.lock': File exists.",
	'',
	'Another git process seems to be running in this repository, e.g.',
	"an editor opened by 'git commit'. Please make sure all processes",
	'are terminated then try again.',
	'',
].join('\n');
const UNKNOWN = [
	'warning: redirecting to https://github.com/e2e/hutch.git/',
	"error: cannot open '/private/var/folders/vw/T/malini-e2e-QnpA8f/user-data/workstreams/e2e-dbg/.git/FETCH_HEAD': Permission denied",
	'fatal: could not write the commit graph at /private/var/folders/vw/T/malini-e2e-QnpA8f/objects/info',
	'',
].join('\n');

describe('gitFailureVerdict', () => {
	it('names a folder that vanished under git, and reads it as not found', () => {
		const stderr =
			"fatal: cannot change to '/private/var/folders/vw/T/malini-e2e-x/user-data/workstreams/ws-gone': No such file or directory";
		expect(gitFailureVerdict(stderr)).toEqual({
			kind: 'io',
			message: 'The folder ws-gone is missing.',
			code: 'ENOENT',
		});
		const error = GitError.commandFailed({
			args: ['status'],
			exitCode: 128,
			signal: null,
			output: stderr,
		});
		expect(isNotFoundError(error)).toBe(true);
	});

	it.each([
		['an unreachable proxy', PROXY_UNREACHABLE],
		['a DNS failure', DNS_FAILURE],
		['an ssh DNS failure', SSH_DNS_FAILURE],
	])('names the host it could not reach for %s', (_, stderr) => {
		expect(gitFailureVerdict(stderr)).toEqual({
			kind: 'git',
			message: "Couldn't reach github.com. Check your connection and try again.",
		});
	});

	it.each([
		['a 403', FORBIDDEN],
		['a 401', UNAUTHORIZED],
		['missing credentials', NO_CREDENTIALS],
	])('sends the user to sign in to GitHub for %s', (_, stderr) => {
		expect(gitFailureVerdict(stderr)).toEqual({
			kind: 'auth-failed',
			message: 'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.',
		});
	});

	it('names the repository GitHub could not find', () => {
		expect(gitFailureVerdict(NOT_FOUND)).toEqual({
			kind: 'repository-not-found',
			message:
				"GitHub couldn't find e2e/hutch, or this account can't see it. Check the URL, or sign in to GitHub in Settings as an account that can.",
		});
	});

	it.each([
		['fetch first', FETCH_FIRST],
		['non-fast-forward', NON_FAST_FORWARD],
	])('says the remote branch moved on a %s rejection', (_, stderr) => {
		expect(gitFailureVerdict(stderr)).toEqual({
			kind: 'git',
			message: 'The remote branch has new commits. Update this branch and try again.',
		});
	});

	it('lists the conflicted files git reported', () => {
		expect(gitFailureVerdict(MERGE_CONFLICT).message).toBe(
			'Merge conflict in src/app.ts, README.md. Resolve the conflicts and try again.',
		);
		const many = ['a', 'b', 'c', 'd', 'e']
			.map((name) => `CONFLICT (content): Merge conflict in ${name}.txt`)
			.join('\n');
		expect(gitFailureVerdict(many).message).toBe(
			'Merge conflict in a.txt, b.txt, c.txt and 2 more. Resolve the conflicts and try again.',
		);
		expect(
			gitFailureVerdict('CONFLICT (modify/delete): a.txt deleted in HEAD and modified in x.')
				.message,
		).toBe('Merge conflict. Resolve the conflicts and try again.');
	});

	it('says git is busy when another process holds index.lock', () => {
		expect(gitFailureVerdict(INDEX_LOCKED)).toEqual({
			kind: 'worktree-busy',
			message: 'Git is busy in this workstream (index.lock). Try again in a moment.',
		});
	});

	it('falls back to the last fatal or error line, without its prefix or absolute paths', () => {
		expect(gitFailureVerdict(UNKNOWN)).toEqual({
			kind: 'git',
			message: 'could not write the commit graph at info',
		});
		expect(gitFailureVerdict(UNKNOWN.split('\n').slice(0, 2).join('\n')).message).toBe(
			"cannot open 'FETCH_HEAD': Permission denied",
		);
	});

	it('names the remote git could not read rather than the generic line after it', () => {
		expect(
			gitFailureVerdict(
				"fatal: '/private/var/folders/x/T/upstream' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
			).message,
		).toBe("'upstream' does not appear to be a git repository");
		expect(gitFailureVerdict('fatal: Could not read from remote repository.\n').message).toBe(
			'Could not read from remote repository.',
		);
	});

	it.each([
		[
			'OAuth App',
			"GitHub refused the push: this change edits `.github/workflows/map-tiles.yml`, and your gh sign-in can't change workflows. Run `gh auth refresh -s workflow` once, then retry.",
		],
		[
			'Personal Access Token',
			"GitHub refused the push: this change edits `.github/workflows/map-tiles.yml`, and your GitHub token can't change workflows. Give it the workflow scope, then retry.",
		],
	])('says how to let a %s push a workflow GitHub refused', (actor, message) => {
		expect(gitFailureVerdict(workflowRefusal(actor, 'workflow` scope'))).toEqual({
			kind: 'git',
			message,
		});
	});

	it('says how to let a GitHub App push a workflow, and keeps any other refusal as GitHub said it', () => {
		expect(gitFailureVerdict(workflowRefusal('GitHub App', 'workflows` permission')).message).toBe(
			"GitHub refused the push: this change edits `.github/workflows/map-tiles.yml`, and the GitHub App Malini pushes with can't change workflows. Give it the Workflows permission, then retry.",
		);
		expect(gitFailureVerdict(RULES_REFUSAL).message).toBe(
			'GitHub refused the push: push declined due to repository rule violations.',
		);
	});

	it('falls back to the last line when git printed no verdict, and admits silence', () => {
		expect(
			gitFailureVerdict('On branch main\nnothing to commit, working tree clean\n').message,
		).toBe('nothing to commit, working tree clean');
		expect(gitFailureVerdict('  \n\n').message).toBe('Git stopped without giving a reason.');
	});
});

describe('remoteRefusal', () => {
	it('keeps what GitHub said when it refused a push, without git progress', () => {
		expect(remoteRefusal(GitError.commandFailed(refusedPush(RULES_REFUSAL)))).toBe(
			[
				'error: GH013: Repository rule violations found for refs/heads/main.',
				'- Changes must be made through a pull request.',
				'push declined due to repository rule violations',
			].join('\n'),
		);
		expect(
			remoteRefusal(
				GitError.commandFailed(refusedPush(workflowRefusal('OAuth App', 'workflow` scope'))),
			),
		).toBe(
			'refusing to allow an OAuth App to create or update workflow `.github/workflows/map-tiles.yml` without `workflow` scope',
		);
	});

	it('has nothing to say for a failure GitHub did not refuse', () => {
		expect(remoteRefusal(GitError.commandFailed(refusedPush(DNS_FAILURE)))).toBeNull();
		expect(remoteRefusal(new Error('boom'))).toBeNull();
	});
});

describe('workflowRefusal', () => {
	const refused = (actor: string, without: string): GitError =>
		GitError.commandFailed(refusedPush(workflowRefusal(actor, without)));

	it('tells a gh sign-in without the workflow scope from a token Malini cannot widen', () => {
		expect(workflowRefusalOf(refused('OAuth App', 'workflow` scope'))).toBe('workflow-scope');
		expect(workflowRefusalOf(refused('Personal Access Token', 'workflow` scope'))).toBe(
			'workflow-permission',
		);
		expect(workflowRefusalOf(refused('GitHub App', 'workflows` permission'))).toBe(
			'workflow-permission',
		);
	});

	it('leaves every other failure to the usual retries', () => {
		expect(workflowRefusalOf(GitError.commandFailed(refusedPush(RULES_REFUSAL)))).toBeNull();
		expect(workflowRefusalOf(new Error('boom'))).toBeNull();
	});
});

describe('GitError.commandFailed', () => {
	const pushArgs = [
		'-C',
		'/private/var/folders/vw/T/malini-e2e-QnpA8f/user-data/workstreams/e2e-dbg',
		'-c',
		'credential.helper=',
		'-c',
		'credential.helper=!gh auth git-credential',
		'-c',
		'core.hooksPath=/dev/null',
		'push',
		'--no-verify',
		'https://github.com/e2e/hutch.git',
		'malini/e2e-dbg:refs/heads/malini/e2e-dbg',
	];

	it('shows only the human message and keeps the command, exit code and stderr as its cause', () => {
		const error = GitError.commandFailed({
			args: pushArgs,
			exitCode: 128,
			signal: null,
			output: PROXY_UNREACHABLE,
		});

		expect(error.message).toBe("Couldn't reach github.com. Check your connection and try again.");
		for (const leak of ['git -C', '-c credential.helper', 'Some(', 'exit=', '/private/var']) {
			expect(error.message).not.toContain(leak);
		}
		expect(error).toMatchObject({ kind: 'git', exitCode: 128, detail: PROXY_UNREACHABLE });
		const technical = technicalDetail(error);
		expect(technical).toContain(
			'-c credential.helper= -c credential.helper=[redacted] -c core.hooksPath=/dev/null push',
		);
		expect(technical).toContain('exited with code 128\nfatal: unable to access');
		expect(technical).not.toContain('gh auth git-credential');
		expect(technical).not.toContain('Some(');
	});

	it('describes a git that was stopped by a signal', () => {
		const error = GitError.commandFailed({
			args: ['fetch'],
			exitCode: null,
			signal: 'SIGTERM',
			output: '',
			outputTruncated: true,
		});
		expect(technicalDetail(error)).toBe('git fetch was stopped by SIGTERM\n\n[output truncated]');
	});

	it('keeps the human message, the stderr and the cause when it attributes credentials', () => {
		const failure = GitError.commandFailed({
			args: ['ls-remote', 'https://github.com/e2e/hutch.git'],
			exitCode: 128,
			signal: null,
			output: NO_CREDENTIALS,
		});

		expect(attributeCredentials(failure, null)).toMatchObject({
			kind: 'auth-failed',
			credentials: 'none',
			message: 'GitHub needs you to sign in. Sign in to GitHub in Settings, then try again.',
			detail: NO_CREDENTIALS,
			exitCode: 128,
			cause: failure.cause,
		});
		expect(attributeCredentials(failure, 'ghs_secret_value').message).toBe(
			'GitHub rejected the sign-in. Sign in to GitHub again in Settings, then try again.',
		);
	});
});

describe('GhError.fromStderr', () => {
	it.each([
		[
			'exhausted ports',
			'Post "https://api.github.com/graphql": dial tcp 140.82.121.5:443: connect: can\'t assign requested address\n',
			'the connection failed',
		],
		[
			'an unreachable proxy',
			'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused\n',
			'the connection was refused',
		],
		[
			'a DNS failure',
			'Get "https://api.github.com/user": dial tcp: lookup api.github.com: no such host\n',
			"its address didn't resolve",
		],
		[
			'a timeout',
			'Post "https://api.github.com/graphql": dial tcp 140.82.121.6:443: i/o timeout\n',
			'the connection timed out',
		],
		[
			'gh naming the host',
			'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n',
			"its address didn't resolve",
		],
	])(
		'says why GitHub is not responding for %s and keeps the raw line as its cause',
		(_, stderr, why) => {
			const error = GhError.fromStderr(stderr, 1);

			expect(error).toMatchObject({
				kind: 'unreachable',
				message: `GitHub is not responding: ${why}. Check your internet connection, VPN or proxy.`,
				stderr,
			});
			expect(error.cause).toBeInstanceOf(Error);
			expect(githubFailure(error.message)).toBe('unreachable');
		},
	);

	it.each([
		[
			'HTTP 503: No server is currently available to service your request. Sorry about that. (https://api.github.com/graphql)\n',
			'HTTP 503',
		],
		['non-200 OK status code: 502 Bad Gateway body: "<html>"\n', 'HTTP 502'],
		[
			'GraphQL: Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.\n',
			'with an internal error',
		],
	])('says GitHub is down when it answers %s', (stderr, answer) => {
		const error = GhError.fromStderr(stderr, 1);

		expect(error).toMatchObject({
			kind: 'down',
			message: `GitHub is down: it answered ${answer}. Your connection works; the problem is on GitHub's side.`,
		});
		expect(githubFailure(error.message)).toBe('down');
	});

	it('says GitHub hit its rate limit', () => {
		const error = GhError.fromStderr(
			'GraphQL: API rate limit exceeded for user ID 1234. (https://api.github.com/graphql)\n',
			1,
		);

		expect(error).toMatchObject({
			kind: 'rate-limited',
			message:
				'GitHub hit its rate limit for this account. Malini reads GitHub again once the limit resets.',
		});
		expect(githubFailure(error.message)).toBe('rate-limited');
	});

	it('keeps any other gh failure as gh wrote it', () => {
		expect(
			GhError.fromStderr('GraphQL: Could not resolve to a PullRequest (repository)\n', 1),
		).toMatchObject({
			kind: 'failed',
			message: 'GraphQL: Could not resolve to a PullRequest (repository)',
		});
	});
});

function technicalDetail(error: GitError): string {
	if (!(error.cause instanceof Error))
		throw new Error('the git failure carries no technical cause');
	return error.cause.message;
}

const RULES_REFUSAL = [
	'Enumerating objects: 5, done.',
	'remote: Resolving deltas: 100% (1/1), completed with 1 local object.',
	'remote: error: GH013: Repository rule violations found for refs/heads/main.',
	'remote: ',
	'remote: - Changes must be made through a pull request.',
	'To https://github.com/acme/atlas.git',
	' ! [remote rejected] main -> main (push declined due to repository rule violations)',
	"error: failed to push some refs to 'https://github.com/acme/atlas.git'",
].join('\n');

function workflowRefusal(actor: string, without: string): string {
	const article = actor === 'OAuth App' ? 'an' : 'a';
	return [
		'To https://github.com/acme/atlas.git',
		` ! [remote rejected] malini/01J9879BA4 -> malini/01J9879BA4 (refusing to allow ${article} ${actor} to create or update workflow \`.github/workflows/map-tiles.yml\` without \`${without})`,
		"error: failed to push some refs to 'https://github.com/acme/atlas.git'",
	].join('\n');
}

function refusedPush(output: string): GitCommandFailure {
	return {
		args: ['push', 'https://github.com/acme/atlas.git', 'HEAD:main'],
		exitCode: 1,
		signal: null,
		output,
		outputTruncated: false,
	};
}
