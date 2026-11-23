import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubFailure } from '$contract/github-failure';
import {
	attributeCredentials,
	GhError,
	GitError,
	gitFailureVerdict,
	gitMissingMessage,
	isNotFoundError,
	MaliniError,
	remoteRefusal,
	waitsForYou,
	type GitCommandFailure,
} from './errors';
import {
	GH_SAID,
	GIT_SAID,
	ghSaid,
	gitMessageTemplate,
	gitSaid,
	isGitMessageTemplate,
	type GhSaid,
	type GitSaid,
} from './failure-facts';

const PROXY_UNREACHABLE =
	"fatal: unable to access 'https://github.com/e2e/hutch.git/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server\n";
const DNS_FAILURE =
	"fatal: unable to access 'https://github.com/e2e/hutch.git/': Could not resolve host: github.com\n";
const SSH_DNS_FAILURE =
	'ssh: Could not resolve hostname github.com: nodename nor servname provided, or not known\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n';
const FORBIDDEN =
	"remote: Permission to e2e/hutch.git denied to e2e-user.\nfatal: unable to access 'https://github.com/e2e/hutch.git/': The requested URL returned error: 403\n";
const SSH_FORBIDDEN =
	'ERROR: Permission to e2e/hutch.git denied to deploy key\nfatal: Could not read from remote repository.\n';
const TOKEN_FORBIDDEN =
	"remote: Write access to repository not granted.\nfatal: unable to access 'https://github.com/e2e/hutch.git/': The requested URL returned error: 403\n";
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
			kind: 'network',
			message: "Couldn't reach github.com. Check your connection and try again.",
		});
	});

	it.each([
		['a 403', FORBIDDEN, "`e2e-user` can't push to e2e/hutch."],
		['an ssh refusal', SSH_FORBIDDEN, "`deploy key` can't push to e2e/hutch."],
		[
			'a token without write access',
			TOKEN_FORBIDDEN,
			"This GitHub account can't push to e2e/hutch.",
		],
	])(
		'names who cannot push where for %s, since signing in again changes nothing',
		(_, stderr, who) => {
			expect(gitFailureVerdict(stderr)).toEqual({
				kind: 'push-denied',
				message: `${who} Ask its owners for write access, then retry.`,
			});
		},
	);

	it.each([
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
			kind: 'remote-ahead',
			message: 'The remote branch has new commits. Update this branch and try again.',
		});
	});

	it('lists the conflicted files git reported', () => {
		expect(gitFailureVerdict(MERGE_CONFLICT)).toEqual({
			kind: 'merge-conflict',
			message: 'Merge conflict in src/app.ts, README.md. Resolve the conflicts and try again.',
		});
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

	it('says how to get git on each OS when it is missing', () => {
		const bin = mkdtempSync(join(tmpdir(), 'malini-package-manager-'));
		const tool = join(bin, process.platform === 'win32' ? 'dnf.exe' : 'dnf');
		writeFileSync(tool, '');
		chmodSync(tool, 0o755);
		try {
			expect(gitMissingMessage('win32')).toBe(
				'Git for Windows is not on this PC. Press Try again on the Repositories page.',
			);
			expect(gitMissingMessage('linux', bin)).toBe(
				'Git is not installed. Run sudo dnf install git in a terminal, then try again.',
			);
			expect(gitMissingMessage('linux', '')).toBe(
				'Git is not installed. Install it with your package manager, then try again.',
			);
			expect(
				gitFailureVerdict(
					'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun\n',
				),
			).toEqual({
				kind: 'git-unavailable',
				message:
					'Git needs the Command Line Tools. Run xcode-select --install in Terminal, then try again.',
			});
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
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
			"fatal: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\e2e\\upstream' does not appear to be a git repository",
			"'upstream' does not appear to be a git repository",
		],
		[
			"fatal: '\\\\server\\share\\upstream' does not appear to be a git repository",
			"'upstream' does not appear to be a git repository",
		],
		[
			'fatal: could not write the commit graph at C:/Users/me/AppData/Local/Temp/objects/info',
			'could not write the commit graph at info',
		],
	])('drops the folders of a Windows path in %s', (stderr, message) => {
		expect(gitFailureVerdict(`${stderr}\n`).message).toBe(message);
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
			kind: 'remote-rejected',
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

	it.each(['/Users/me/malini/brain', 'C:\\Users\\me\\malini\\brain\\', '\\\\server\\share\\brain'])(
		'names the folder %s, not GitHub, when the folder refused the push',
		(folder) => {
			expect(
				gitFailureVerdict(
					`To ${folder}\n ! [remote rejected] HEAD -> main (Working directory has unstaged changes)\nerror: failed to push some refs to '${folder}'\n`,
				).message,
			).toBe('The folder brain refused the push: Working directory has unstaged changes.');
		},
	);

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

describe('waitsForYou', () => {
	const refused = (actor: string, without: string): GitError =>
		GitError.commandFailed(refusedPush(workflowRefusal(actor, without)));

	it('tells a gh sign-in without the workflow scope from a token Malini cannot widen', () => {
		expect(waitsForYou(refused('OAuth App', 'workflow` scope'))).toBe('workflow-scope');
		expect(waitsForYou(refused('Personal Access Token', 'workflow` scope'))).toBe(
			'workflow-permission',
		);
		expect(waitsForYou(refused('GitHub App', 'workflows` permission'))).toBe('workflow-permission');
	});

	it('waits for write access GitHub denied', () => {
		expect(waitsForYou(GitError.commandFailed(refusedPush(FORBIDDEN)))).toBe('push-access');
	});

	it('leaves every other failure to the usual retries', () => {
		expect(waitsForYou(GitError.commandFailed(refusedPush(RULES_REFUSAL)))).toBeNull();
		expect(waitsForYou(new Error('boom'))).toBeNull();
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
		expect(error).toMatchObject({ kind: 'network', exitCode: 128, detail: PROXY_UNREACHABLE });
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

describe('what git said', () => {
	const SAID: Readonly<Record<Exclude<GitSaid, 'unrecognized'>, string>> = {
		'dubious-ownership':
			"fatal: detected dubious ownership in repository at '/Users/me/acme'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /Users/me/acme\n",
		'bad-object':
			'error: object file .git/objects/ab/cdef is empty\nfatal: loose object abcdef (stored in .git/objects/ab/cdef) is corrupt\n',
		'index-corrupt': 'error: bad signature 0x00000000\nfatal: index file corrupt\n',
		'head-invalid':
			"fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n",
		'unknown-revision':
			"fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.\n",
		pathspec: "error: pathspec 'src/x.ts' did not match any file(s) known to git\n",
		'not-a-work-tree': 'fatal: not a git repository (or any of the parent directories): .git\n',
		'permission-denied': 'error: unable to create file src/a.ts: Permission denied\n',
		'no-space': 'fatal: write error: No space left on device\n',
		'developer-tools-missing':
			'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun\n',
		'license-not-accepted':
			"You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window.\n",
		'clone-target-exists':
			"fatal: destination path 'acme' already exists and is not an empty directory.\n",
		'shallow-or-partial': 'fatal: could not fetch abc123 from promisor remote\n',
	};

	it('names every listed git message and never falls back to unrecognized for one', () => {
		expect(GIT_SAID.filter((said) => said !== 'unrecognized').sort()).toEqual(
			Object.keys(SAID).sort(),
		);
		for (const [said, output] of Object.entries(SAID))
			expect([said, gitSaid(output)]).toEqual([said, said]);
		expect(gitSaid("fatal: Invalid path '/r/acme/base': No such file or directory\n")).toBe(
			'not-a-work-tree',
		);
		expect(gitSaid('fatal: gitfile does not point to a valid repository: /r/acme/ws/.git\n')).toBe(
			'not-a-work-tree',
		);
		expect(gitSaid('fatal: invalid gitfile format: /r/acme/ws/.git\n')).toBe('not-a-work-tree');
		expect(gitSaid('fatal: your current branch appears to be broken\n')).toBe('head-invalid');
		expect(gitSaid('fatal: index-pack failed\n')).toBe('unrecognized');
	});

	it('names what gh said', () => {
		const SAID: Readonly<Partial<Record<GhSaid, string>>> = {
			'not-found': 'HTTP 404: Not Found (https://api.github.com/repos/me/acme)',
			forbidden: 'HTTP 403: Resource not accessible by integration',
			'already-exists': 'a pull request for branch "malini/x" into branch "main" already exists',
			'no-commits': 'pull request create failed: GraphQL: No commits between main and malini/x',
			unprocessable: 'HTTP 422: Validation Failed',
			graphql: 'GraphQL: Something went wrong while executing your query.',
		};
		for (const [said, stderr] of Object.entries(SAID))
			expect([said, ghSaid(stderr)]).toEqual([said, said]);
		expect(GH_SAID).toContain('unrecognized');
		expect(ghSaid('something new')).toBe('unrecognized');
	});

	it('gives a git failure its subcommand and how git ended, and what git said for the catch-all', () => {
		const failure = GitError.commandFailed({
			args: ['-C', '/Users/me/acme', '-c', 'core.hooksPath=/dev/null', 'read-tree', 'HEAD'],
			exitCode: 128,
			signal: null,
			output: 'error: bad signature 0x00000000\nfatal: index file corrupt\n',
		});
		expect([failure.kind, failure.facts]).toEqual([
			'git',
			{ subcommand: 'read-tree', exit: 128, said: 'index-corrupt' },
		]);
		const killed = GitError.commandFailed({
			args: ['status'],
			exitCode: null,
			signal: 'SIGKILL',
			output: '',
		});
		expect(killed.facts).toMatchObject({ subcommand: 'status', signal: 'SIGKILL' });
		const gh = GhError.fromStderr('HTTP 403: Resource not accessible by integration', 1, [
			'api',
			'repos/me/acme',
		]);
		expect([gh.kind, gh.facts]).toEqual([
			'failed',
			{ subcommand: 'api', exit: 1, said: 'forbidden' },
		]);
	});

	it('sends an unrecognized git message as a template of git words, never a name, path or number', () => {
		const output =
			"error: cannot lock ref 'refs/heads/main': is at 1a2b3c but expected 4d5e6f\nfatal: unable to write new index file in /Users/me/secret-client/.git 42 times\n";
		const template = gitMessageTemplate(output);
		expect(template).toBe('unable to write _ index file in _');
		expect(isGitMessageTemplate(template ?? '')).toBe(true);
		expect(isGitMessageTemplate('unable to write secret-client')).toBe(false);
		const failure = GitError.commandFailed({
			args: ['add', '-A'],
			exitCode: 128,
			signal: null,
			output,
		});
		expect(failure.facts).toEqual({
			subcommand: 'add',
			exit: 128,
			said: 'unrecognized',
			template: 'unable to write _ index file in _',
		});
	});
});

describe('MaliniError', () => {
	class WrapError extends MaliniError<'wrapped'> {
		constructor(cause: unknown) {
			super('WrapError', { wrapped: 'bug' }, 'wrapped', 'wrapped', { cause });
		}
	}
	const failed = (output: string): GitError =>
		GitError.commandFailed({ args: ['add', '-A'], exitCode: 128, signal: null, output });

	it('keeps what the user must fix, and what git said, through an error that wraps it', () => {
		const busy = failed("fatal: Unable to create '/Users/me/acme/.git/index.lock': File exists.\n");
		const corrupt = failed('error: bad signature 0x00000000\nfatal: index file corrupt\n');
		expect([busy.verdict, new WrapError(busy).verdict]).toEqual(['expected', 'expected']);
		expect([new WrapError(corrupt).verdict, new WrapError(corrupt).facts]).toEqual([
			'bug',
			{ subcommand: 'add', exit: 128, said: 'index-corrupt' },
		]);
		expect(new WrapError(new Error('plain')).verdict).toBe('bug');
	});

	it('starts its stack where it was thrown, not in the error class', () => {
		const firstFrame = new WrapError(null).stack?.split('\n')[1] ?? '';
		expect(firstFrame).toContain('errors.test.ts');
		expect(firstFrame).not.toMatch(/new (?:WrapError|MaliniError)/u);
	});
});
