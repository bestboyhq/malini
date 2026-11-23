import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCode, failureOutput, GitError } from '$main/errors';
import { GH_CREDENTIAL_HELPER_CONFIG, noPromptCredentialEnv } from '$main/git/credentials';
import { canonicalGithubHttpsUrl } from '$main/git/paths';
import {
	ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG,
	DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG,
	DISABLED_GIT_HOOKS_CONFIG,
	REQUIRE_TLS_VERIFICATION_CONFIG,
	runGit,
	runGitAllowingExit,
	runGitWithInput,
} from '$main/git/run';
import { AGENT_IDENTITY } from '$main/git/snapshots';
import { PLAN_FILE } from './plan-file';

export type PlanClone = Readonly<{ path: string; url: string }>;

export type CommitIdentity = Readonly<{ name: string; email: string }>;

const REMOTE_MAIN = 'refs/remotes/origin/main';

const REJECTED = /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)/u;

const NETWORK_CONFIG = [
	...GH_CREDENTIAL_HELPER_CONFIG,
	'-c',
	DISABLED_GIT_HOOKS_CONFIG,
	'-c',
	DENY_UNDECLARED_GIT_PROTOCOLS_CONFIG,
	'-c',
	ALLOW_GITHUB_HTTPS_PROTOCOL_CONFIG,
	'-c',
	REQUIRE_TLS_VERIFICATION_CONFIG,
];

const AUTHORS_READ = 200;

export async function openPlanClone(appDataRoot: string, home: string): Promise<PlanClone> {
	const [owner = '', name = ''] = home.toLowerCase().split('/');
	const path = join(appDataRoot, 'plans', owner, `${name}.git`);
	if (await isMissing(join(path, 'HEAD'))) {
		await mkdir(path, { recursive: true });
		await runGit(['init', '-q', '--bare', path]);
	}
	return { path, url: canonicalGithubHttpsUrl(home) };
}

export async function fetchPlan(clone: PlanClone): Promise<string | null> {
	const env = await noPromptCredentialEnv.prepare(null);
	await runGit(
		[
			'-C',
			clone.path,
			...NETWORK_CONFIG,
			'fetch',
			'-q',
			'--prune',
			'--no-tags',
			clone.url,
			'+refs/heads/*:refs/remotes/origin/*',
		],
		env,
	);
	return commitOf(clone, REMOTE_MAIN);
}

export async function commitOf(clone: PlanClone, revision: string): Promise<string | null> {
	const found = await runGitAllowingExit(
		['-C', clone.path, 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
		1,
	);
	return found.allowed ? null : found.stdout.trim();
}

export async function planTextAt(clone: PlanClone, commit: string | null): Promise<string | null> {
	if (commit === null) return null;
	const listed = await runGit([
		'-C',
		clone.path,
		'ls-tree',
		'--name-only',
		commit,
		'--',
		PLAN_FILE,
	]);
	if (listed.trim() !== PLAN_FILE) return null;
	return runGit(['-C', clone.path, 'cat-file', 'blob', `${commit}:${PLAN_FILE}`]);
}

export async function commitPlan(
	clone: PlanClone,
	parent: string | null,
	text: string,
	message: string,
	author: CommitIdentity | null,
): Promise<string> {
	const git = async (args: readonly string[], input: string): Promise<string> =>
		(await runGitWithInput(['-C', clone.path, ...args], input)).trim();
	const blob = await git(['hash-object', '-w', '--stdin'], text);
	const others =
		parent === null
			? []
			: (await runGit(['-C', clone.path, 'ls-tree', '-z', parent]))
					.split('\0')
					.filter((entry) => entry.length > 0 && !entry.endsWith(`\t${PLAN_FILE}`));
	const tree = await git(
		['mktree', '-z'],
		[...others, `100644 blob ${blob}\t${PLAN_FILE}`, ''].join('\0'),
	);
	const identity = author ?? AGENT_IDENTITY;
	return git(
		[
			'-c',
			`user.name=${identity.name}`,
			'-c',
			`user.email=${identity.email}`,
			'-c',
			'commit.gpgsign=false',
			'commit-tree',
			tree,
			...(parent === null ? [] : ['-p', parent]),
			'-F',
			'-',
		],
		message,
	);
}

export async function pushPlan(clone: PlanClone, commit: string): Promise<boolean> {
	const env = await noPromptCredentialEnv.prepare(null);
	try {
		await runGit(
			[
				'-C',
				clone.path,
				...NETWORK_CONFIG,
				'push',
				'-q',
				'--no-verify',
				clone.url,
				`${commit}:refs/heads/main`,
			],
			env,
		);
	} catch (error) {
		if (error instanceof GitError && REJECTED.test(failureOutput(error))) return false;
		throw error;
	}
	await runGit(['-C', clone.path, 'update-ref', REMOTE_MAIN, commit]);
	return true;
}

export async function planAuthors(
	clone: PlanClone,
	since: string | null,
	commit: string,
): Promise<string[]> {
	const range = since === null ? commit : `${since}..${commit}`;
	const emails = await runGit([
		'-C',
		clone.path,
		'log',
		`--max-count=${AUTHORS_READ}`,
		'--format=%ae',
		range,
	]);
	return emails.split('\n').filter((email) => email.length > 0);
}

async function isMissing(path: string): Promise<boolean> {
	try {
		await stat(path);
		return false;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return true;
		throw error;
	}
}
