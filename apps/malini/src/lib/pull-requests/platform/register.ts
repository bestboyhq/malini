import type { LocalBaseSyncedPayload } from '$contract/events';
import type { AddressedReviewThreadsDto } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { failureOutput } from '$main/errors';
import { noPromptCredentialEnv } from '$main/git/credentials';
import { fastForwardCheckout, syncRemoteBase } from '$main/git/remote';
import { runGit } from '$main/git/run';
import { statusCollector } from '$main/git/status';
import type { MaliniDatabase } from '$main/db/driver';
import { runGh } from '$main/process/gh';
import { getWorkstreamRun } from '$lib/chat/chat.platform';
import {
	claimAlreadyPushedRunThreadResolution,
	claimCommitRunThreadResolution,
	commitRunConsumed,
	createCheckoutResolver,
	resolveConnectedRepository,
	resolveRepositoryCheckout,
	type ConnectedRepository,
} from '$shared/repositories/repositories.platform';
import { addressedReviewThreadIds } from '../domain/pull-request-fix-prompt';
import {
	optionalBoolean,
	optionalNumber,
	optionalString,
	optionalTextUpdate,
	requireNumber,
	requireString,
} from './args';
import {
	fetchCheckDiagnostics,
	fetchReviewFeedback,
	firstLine,
	mapPullRequestStatus,
	notOpenStatus,
	replyAndResolveReviewThreads,
	runCheckedGh,
	sameText,
	viewPullRequest,
	viewPullRequestText,
	withNotStartedReasons,
	type CheckDiagnosticsDto,
	type GhRunner,
	type PullRequestMetadataDto,
	type PullRequestStatusDto,
	type PullRequestView,
	type ReviewFeedbackDto,
} from './pull-requests.service';

export const PULL_REQUEST_COMMAND_NAMES = [
	'pull-requests.status',
	'pull-requests.create',
	'pull-requests.mark-ready',
	'pull-requests.merge',
	'pull-requests.update-metadata',
	'pull-requests.check-diagnostics',
	'pull-requests.review-feedback',
	'pull-requests.resolve-addressed-review-threads',
] as const;

export interface PullRequestsDeps {
	runner?: GhRunner;
}

export function registerPullRequests(context: MainContext, deps: PullRequestsDeps = {}): void {
	const { commands, db, appDataRoot, events } = context;
	const run: GhRunner = deps.runner ?? ((args, options) => runGh(args, options));
	const checkouts = createCheckoutResolver({ db, appDataRoot });

	const repositoryOrThrow = async (repoId: string): Promise<ConnectedRepository> => {
		const repository = await resolveConnectedRepository(db, repoId);
		if (!repository) throw new Error(`Unknown repository: ${repoId}`);
		return repository;
	};

	const checkoutOrThrow = (repository: ConnectedRepository): string => {
		const checkout = resolveRepositoryCheckout(db, appDataRoot, repository);
		if (!checkout) {
			throw new Error(
				`Repository ${repository.fullName} has no checkout yet. Create a workstream first.`,
			);
		}
		return checkout;
	};

	const targetOrThrow = async (
		args: unknown,
	): Promise<{ repository: ConnectedRepository; checkout: string }> => {
		const repository = await repositoryOrThrow(requireString(args, 'repoId'));
		return { repository, checkout: checkoutOrThrow(repository) };
	};

	commands.define('pull-requests.status', async (args: unknown): Promise<PullRequestStatusDto> => {
		const { repository, checkout } = await targetOrThrow(args);
		const head = requireString(args, 'head');
		const pullRequestNumber = optionalNumber(args, 'pullRequestNumber');
		const view = await viewPullRequest({ run, checkout, head, pullRequestNumber });
		if (!view) return notOpenStatus(head, optionalString(args, 'base') ?? repository.defaultBranch);
		const status = await openPullRequestStatus(run, checkout, repository, view);
		if ((status.state !== 'merged' && status.state !== 'closed') || !status.headSha) return status;
		return {
			...status,
			includesLocalHead: await includesLocalHead(run, checkout, repository, status.headSha, head),
		};
	});

	commands.define('pull-requests.create', async (args: unknown): Promise<PullRequestStatusDto> => {
		const { repository, checkout } = await targetOrThrow(args);
		const head = requireString(args, 'head');
		const base = optionalString(args, 'base') ?? repository.defaultBranch;
		const title = requireString(args, 'title');
		const body = optionalString(args, 'body') ?? '';
		const createArgs = [
			'pr',
			'create',
			'--head',
			head,
			'--base',
			base,
			'--title',
			title,
			'--body',
			body,
		];
		if (optionalBoolean(args, 'draft')) createArgs.push('--draft');
		const created = await runCheckedGh(run, createArgs, checkout);
		const url = firstLine(created.stdout);
		const view = await viewPullRequest({ run, checkout, head, pullRequestNumber: null, url });
		if (!view) throw new Error('Pull request was created but could not be read back');
		return openPullRequestStatus(run, checkout, repository, view);
	});

	commands.define(
		'pull-requests.mark-ready',
		async (args: unknown): Promise<PullRequestStatusDto> => {
			const { repository, checkout } = await targetOrThrow(args);
			const number = requireNumber(args, 'pullRequestNumber');
			await runCheckedGh(run, ['pr', 'ready', String(number)], checkout);
			const view = await viewPullRequest({ run, checkout, head: '', pullRequestNumber: number });
			if (!view) throw new Error(`Pull request #${number} was not found after marking ready`);
			return openPullRequestStatus(run, checkout, repository, view);
		},
	);

	commands.define('pull-requests.merge', async (args: unknown): Promise<PullRequestStatusDto> => {
		const { repository, checkout } = await targetOrThrow(args);
		const number = requireNumber(args, 'pullRequestNumber');
		const expectedHeadSha = requireString(args, 'expectedHeadSha');
		const workstreamId = optionalString(args, 'workstreamId');
		const current = await viewPullRequest({ run, checkout, head: '', pullRequestNumber: number });
		if (!current) throw new Error(`Pull request #${number} was not found`);
		const currentHead = typeof current.headRefOid === 'string' ? current.headRefOid : null;
		if (currentHead && currentHead !== expectedHeadSha) {
			throw new Error('Pull request head moved since it was last read');
		}
		const method = optionalString(args, 'mergeMethod');
		const mergeArgs = ['pr', 'merge', String(number), '--match-head-commit', expectedHeadSha];
		if (method === 'merge' || method === 'squash' || method === 'rebase') {
			mergeArgs.push(`--${method}`);
		}
		const commitTitle =
			optionalString(args, 'commitTitle') ??
			(method === 'squash' ? squashSubject(current.title, number) : null);
		const commitMessage = optionalString(args, 'commitMessage');
		if (commitTitle) mergeArgs.push('--subject', commitTitle);
		if (commitMessage) mergeArgs.push('--body', commitMessage);
		await runCheckedGh(run, mergeArgs, checkout);
		const view = await viewPullRequest({ run, checkout, head: '', pullRequestNumber: number });
		if (!view) throw new Error(`Pull request #${number} was not found after merge`);
		const status = await openPullRequestStatus(run, checkout, repository, view);
		if (status.state === 'merged') {
			const synced = await fastForwardLocalBase(
				checkout,
				status.baseRef || repository.defaultBranch,
			);
			if (synced) {
				events.emit('pull-requests:local-base-synced', { workstreamId, ...synced });
			}
		}
		return status;
	});

	commands.define(
		'pull-requests.update-metadata',
		async (args: unknown): Promise<PullRequestMetadataDto> => {
			const { checkout } = await targetOrThrow(args);
			const number = requireNumber(args, 'pullRequestNumber');
			const title = optionalTextUpdate(args, 'title');
			const body = optionalTextUpdate(args, 'body');
			if (title && !title.next.trim()) throw new Error('A pull request title cannot be empty');
			const current = await viewPullRequestText(run, checkout, number);
			if (!current.open) return { title: null, body: null };
			const ownedTitle = title && sameText(current.title, title.expected) ? title.next : null;
			const ownedBody = body && sameText(current.body, body.expected) ? body.next : null;
			const edits = [
				...(ownedTitle !== null && !sameText(current.title, ownedTitle)
					? ['--title', ownedTitle]
					: []),
				...(ownedBody !== null && !sameText(current.body, ownedBody) ? ['--body', ownedBody] : []),
			];
			if (edits.length > 0) {
				await runCheckedGh(run, ['pr', 'edit', String(number), ...edits], checkout);
			}
			return { title: ownedTitle, body: ownedBody };
		},
	);

	commands.define(
		'pull-requests.check-diagnostics',
		async (args: unknown): Promise<CheckDiagnosticsDto> => {
			const { repository, checkout } = await targetOrThrow(args);
			const number = requireNumber(args, 'pullRequestNumber');
			return fetchCheckDiagnostics(run, checkout, repository, number);
		},
	);

	commands.define(
		'pull-requests.review-feedback',
		async (args: unknown): Promise<ReviewFeedbackDto> => {
			const { repository, checkout } = await targetOrThrow(args);
			const number = requireNumber(args, 'pullRequestNumber');
			return fetchReviewFeedback(run, checkout, repository, number);
		},
	);

	commands.define(
		'pull-requests.resolve-addressed-review-threads',
		async (args: unknown): Promise<AddressedReviewThreadsDto> => {
			const workstreamId = requireString(args, 'workstreamId');
			const runId = requireString(args, 'runId');
			const fixRun = getWorkstreamRun(db, workstreamId, runId);
			const addressed = fixRun ? addressedReviewThreadIds(fixRun.prompt, fixRun.summary ?? '') : [];
			if (addressed.length === 0) return { resolvedThreadIds: [], failures: [] };
			const checkout = await checkouts.resolveCheckout(workstreamId);
			const reply = await claimThreadResolutionReply(run, db, checkout, workstreamId, runId);
			if (reply === null) return { resolvedThreadIds: [], failures: [] };
			return replyAndResolveReviewThreads(run, checkout, addressed, reply);
		},
	);
}

async function claimThreadResolutionReply(
	run: GhRunner,
	db: MaliniDatabase,
	checkout: string,
	workstreamId: string,
	runId: string,
): Promise<string | null> {
	const commitSha = claimCommitRunThreadResolution(db, workstreamId, runId);
	if (commitSha) return `Addressed in ${commitSha.slice(0, 7)}.`;
	if (commitRunConsumed(db, workstreamId, runId)) return null;
	const pushedSha = await pullRequestHeadOfCleanCheckout(run, checkout);
	return pushedSha && claimAlreadyPushedRunThreadResolution(db, workstreamId, runId, pushedSha)
		? `Already addressed in ${pushedSha.slice(0, 7)}.`
		: null;
}

async function pullRequestHeadOfCleanCheckout(
	run: GhRunner,
	checkout: string,
): Promise<string | null> {
	const local = await statusCollector(checkout);
	if (!local.headSha || local.dirtyPaths.length > 0 || local.operationInProgress) return null;
	const view = await viewPullRequest({
		run,
		checkout,
		head: local.branch,
		pullRequestNumber: null,
	});
	return view?.state === 'OPEN' && view.headRefOid === local.headSha ? local.headSha : null;
}

async function fastForwardLocalBase(
	checkout: string,
	base: string,
): Promise<Omit<LocalBaseSyncedPayload, 'workstreamId'> | null> {
	const branch = await currentBranchOf(checkout);
	if (branch !== base) return null;
	try {
		const ref = await syncRemoteBase(checkout, base, null, noPromptCredentialEnv);
		const outcome = await fastForwardCheckout(checkout, ref);
		return outcome === 'current' ? null : { checkout, branch, outcome };
	} catch (error) {
		return { checkout, branch, outcome: 'failed', detail: failureOutput(error) };
	}
}

async function currentBranchOf(checkout: string): Promise<string | null> {
	try {
		return (await runGit(['-C', checkout, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	} catch {
		return null;
	}
}

function squashSubject(title: unknown, number: number): string | null {
	return typeof title === 'string' && title.trim() ? `${title.trim()} (#${number})` : null;
}

async function openPullRequestStatus(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	view: PullRequestView,
): Promise<PullRequestStatusDto> {
	const status = mapPullRequestStatus(await withSettledMergeability(run, checkout, view));
	if (status.state !== 'open' || status.number === null) return status;
	if (status.headSha) await fetchHeadGithubMoved(checkout, status.headRef, status.headSha);
	const [threads, merging, checksExpected, lagging, behindBase, checks] = await Promise.all([
		unresolvedReviewThreadCount(run, checkout, repository, status.number),
		repositoryMergeSettings(run, checkout),
		status.checksState === 'none' && status.headSha
			? checksAreStarting(checkout, status.headSha)
			: false,
		status.headSha ? pullRequestLagsPush(checkout, status.headRef, status.headSha) : false,
		status.headSha && status.baseRef
			? fetchBehindBase(run, checkout, repository, status.baseRef, status.headSha)
			: null,
		withNotStartedReasons(run, checkout, repository, status.checks),
	]);
	const read: PullRequestStatusDto = {
		...status,
		checks,
		...(checksExpected ? { checksState: 'pending' as const } : {}),
		unresolvedReviewThreadCount: threads,
		...(merging ?? {}),
		behindBase,
	};
	if (lagging) return { ...read, ...UNREPORTED_PUSHED_HEAD };
	if (mergeabilityPredatesHead(read)) return { ...read, ...UNREPORTED_MERGEABILITY };
	return read;
}

const UNREPORTED_MERGEABILITY: Pick<PullRequestStatusDto, 'mergeable' | 'mergeableState'> = {
	mergeable: null,
	mergeableState: 'UNKNOWN',
};

const UNREPORTED_PUSHED_HEAD: Pick<
	PullRequestStatusDto,
	'mergeable' | 'mergeableState' | 'includesLocalHead' | 'checksState' | 'checks' | 'behindBase'
> = {
	...UNREPORTED_MERGEABILITY,
	includesLocalHead: false,
	checksState: 'pending',
	checks: [],
	behindBase: null,
};

function mergeabilityPredatesHead(status: PullRequestStatusDto): boolean {
	const state = status.mergeableState?.toUpperCase();
	return (
		status.behindBase === 0 &&
		(status.mergeable === false || state === 'DIRTY' || state === 'BEHIND')
	);
}

async function fetchBehindBase(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	base: string,
	headSha: string,
): Promise<number | null> {
	try {
		const result = await run(
			['api', `repos/${repository.fullName}/compare/${base}...${headSha}`, '--jq', '.behind_by'],
			{ cwd: checkout },
		);
		if (result.code !== 0) return null;
		const n = Number(result.stdout.trim());
		return Number.isFinite(n) && n >= 0 ? n : null;
	} catch {
		return null;
	}
}

async function branchHead(checkout: string, ref: string): Promise<string> {
	return (await runGit(['-C', checkout, 'rev-parse', '--verify', `${ref}^{commit}`])).trim();
}

async function fetchHeadGithubMoved(
	checkout: string,
	branch: string,
	pullRequestHead: string,
): Promise<void> {
	const local = await branchHead(checkout, `refs/heads/${branch}`).catch(() => null);
	if (!local || local === pullRequestHead) return;
	const pushed = await branchHead(checkout, `refs/remotes/origin/${branch}`).catch(() => null);
	if (pushed === pullRequestHead) return;
	try {
		await runGit(['-C', checkout, 'merge-base', '--is-ancestor', pullRequestHead, local]);
	} catch {
		await syncRemoteBase(checkout, branch, null, noPromptCredentialEnv).catch(() => null);
	}
}

async function pullRequestLagsPush(
	checkout: string,
	branch: string,
	pullRequestHead: string,
): Promise<boolean> {
	try {
		const [local, pushed] = await Promise.all([
			branchHead(checkout, `refs/heads/${branch}`),
			branchHead(checkout, `refs/remotes/origin/${branch}`),
		]);
		if (local !== pushed || local === pullRequestHead) return false;
		await runGit(['-C', checkout, 'merge-base', '--is-ancestor', pullRequestHead, local]);
		return true;
	} catch {
		return false;
	}
}

async function includesLocalHead(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	pullRequestHead: string,
	branch: string,
): Promise<boolean | null> {
	try {
		const local = await branchHead(checkout, `refs/heads/${branch}`);
		if (local === pullRequestHead) return true;
		const compared = await run(
			[
				'api',
				`repos/${repository.fullName}/compare/${pullRequestHead}...${local}`,
				'--jq',
				'.status',
			],
			{ cwd: checkout },
		);
		if (compared.code !== 0) return null;
		const relation = compared.stdout.trim();
		return relation === 'identical' || relation === 'behind';
	} catch {
		return null;
	}
}

export const CHECKS_START_GRACE_MS = 5 * 60_000;

// ponytail: the head's commit time stands in for its push time, and any workflow naming pull_request counts as one that runs here
async function checksAreStarting(checkout: string, headSha: string): Promise<boolean> {
	try {
		const committedAt = Number(
			(await runGit(['-C', checkout, 'show', '-s', '--format=%ct', headSha])).trim(),
		);
		if (Date.now() - committedAt * 1000 > CHECKS_START_GRACE_MS) return false;
		await runGit([
			'-C',
			checkout,
			'grep',
			'-q',
			'pull_request',
			headSha,
			'--',
			'.github/workflows',
		]);
		return true;
	} catch {
		return false;
	}
}

export const MERGEABILITY_SETTLE_DELAYS_MS = [1_500, 3_000] as const;

async function withSettledMergeability(
	run: GhRunner,
	checkout: string,
	view: PullRequestView,
): Promise<PullRequestView> {
	let current = view;
	for (const delay of MERGEABILITY_SETTLE_DELAYS_MS) {
		if (current.state !== 'OPEN' || current.mergeable !== 'UNKNOWN') return current;
		if (typeof current.number !== 'number') return current;
		await new Promise((resolve) => setTimeout(resolve, delay));
		current =
			(await viewPullRequest({ run, checkout, head: '', pullRequestNumber: current.number })) ??
			current;
	}
	return current;
}

type MergeSettings = Pick<
	PullRequestStatusDto,
	'allowedMergeMethods' | 'defaultMergeMethod' | 'viewerCanMerge'
>;

async function repositoryMergeSettings(
	run: GhRunner,
	checkout: string,
): Promise<MergeSettings | null> {
	const result = await run(
		[
			'repo',
			'view',
			'--json',
			'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,viewerDefaultMergeMethod,viewerPermission',
		],
		{ cwd: checkout },
	).catch(() => null);
	if (result?.code !== 0) return null;
	let settings: unknown;
	try {
		settings = JSON.parse(result.stdout);
	} catch {
		return null;
	}
	if (typeof settings !== 'object' || settings === null) return null;
	const flag = (key: string): boolean => Reflect.get(settings, key) === true;
	const text = (key: string): string => String(Reflect.get(settings, key) ?? '').toLowerCase();
	const allowedMergeMethods = [
		...(flag('mergeCommitAllowed') ? ['merge'] : []),
		...(flag('squashMergeAllowed') ? ['squash'] : []),
		...(flag('rebaseMergeAllowed') ? ['rebase'] : []),
	];
	const preferred = text('viewerDefaultMergeMethod');
	return {
		allowedMergeMethods,
		defaultMergeMethod: allowedMergeMethods.includes(preferred) ? preferred : null,
		viewerCanMerge: ['admin', 'maintain', 'write'].includes(text('viewerPermission')),
	};
}

async function unresolvedReviewThreadCount(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	number: number,
): Promise<number | null> {
	try {
		const feedback = await fetchReviewFeedback(run, checkout, repository, number);
		const count = feedback.unresolvedThreads?.length ?? 0;
		return feedback.unresolvedThreadsComplete || count > 0 ? count : null;
	} catch {
		return null;
	}
}
