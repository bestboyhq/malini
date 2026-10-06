import type { AddressedReviewThreadsDto } from '$contract/repositories';
import type { ConnectedRepository } from '$shared/repositories/repositories.platform';
import { GhError, describeError } from '$main/errors';
import { parseGhJson, type GhResult } from '$main/process/gh';
import { checkNotStartedReason } from '../domain/check-not-started';

export type GhRunner = (args: readonly string[], options?: { cwd?: string }) => Promise<GhResult>;

const PR_VIEW_FIELDS = [
	'number',
	'state',
	'isDraft',
	'title',
	'url',
	'headRefName',
	'baseRefName',
	'headRefOid',
	'mergeable',
	'mergeStateStatus',
	'reviewDecision',
	'statusCheckRollup',
	'updatedAt',
].join(',');

const DIAGNOSTIC_PAGE_LIMIT = 1000;

export interface PullRequestView {
	number?: unknown;
	state?: unknown;
	isDraft?: unknown;
	title?: unknown;
	url?: unknown;
	headRefName?: unknown;
	baseRefName?: unknown;
	headRefOid?: unknown;
	mergeable?: unknown;
	mergeStateStatus?: unknown;
	reviewDecision?: unknown;
	statusCheckRollup?: unknown;
	updatedAt?: unknown;
}

export interface PullRequestStatusDto {
	state: 'not_open' | 'open' | 'closed' | 'merged';
	number: number | null;
	url: string | null;
	title: string | null;
	draft: boolean | null;
	headRef: string;
	baseRef: string;
	headSha: string | null;
	includesLocalHead: boolean | null;
	mergeable: boolean | null;
	mergeableState: string | null;
	behindBase: number | null;
	checksState: 'none' | 'success' | 'pending' | 'failed' | 'unknown';
	checks: PullRequestCheckDto[];
	viewerCanMerge: boolean | null;
	allowedMergeMethods: string[];
	defaultMergeMethod: string | null;
	reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
	unresolvedReviewThreadCount: number | null;
	updatedAt: string | null;
}

export interface PullRequestCheckDto {
	name: string;
	appId: number | null;
	state: string;
	conclusion: string | null;
	required: boolean | null;
	url: string | null;
	startedAt: string | null;
	completedAt: string | null;
	notStartedReason: string | null;
}

export interface PullRequestMetadataDto {
	title: string | null;
	body: string | null;
}

export interface CheckRunDiagnosticDto {
	id: number;
	name: string;
	appId: number;
	status: string;
	conclusion: string | null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
	outputTitle: string | null;
	outputSummary: string | null;
	outputText: string | null;
	annotationsCount: number;
	annotations: CheckAnnotationDto[] | null;
	annotationsComplete: boolean;
	logExcerpt: string | null;
}

export interface CheckAnnotationDto {
	path: string;
	startLine: number;
	endLine: number;
	startColumn: number | null;
	endColumn: number | null;
	level: 'notice' | 'warning' | 'failure';
	title: string | null;
	message: string;
	rawDetails: string | null;
}

export interface CommitStatusDiagnosticDto {
	id: number;
	context: string;
	state: 'failure' | 'error';
	description: string | null;
	targetUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CheckDiagnosticsDto {
	checkRuns: CheckRunDiagnosticDto[] | null;
	checkRunsComplete: boolean;
	commitStatuses: CommitStatusDiagnosticDto[] | null;
	commitStatusesComplete: boolean;
	truncated: boolean;
}

export interface ReviewThreadDto {
	id: string;
	path: string;
	line: number | null;
	startLine: number | null;
	side: 'LEFT' | 'RIGHT';
	startSide: 'LEFT' | 'RIGHT' | null;
	subjectType: 'LINE' | 'FILE';
	outdated: boolean;
	comments: ReviewCommentDto[];
}

export interface ReviewCommentDto {
	id: string;
	authorLogin: string | null;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface RequestedChangeReviewDto {
	id: string;
	authorLogin: string | null;
	body: string;
	submittedAt: string;
	updatedAt: string;
}

export interface ReviewFeedbackDto {
	unresolvedThreads: ReviewThreadDto[] | null;
	unresolvedThreadsComplete: boolean;
	requestedChangeReviews: RequestedChangeReviewDto[] | null;
	requestedChangeReviewsComplete: boolean;
	truncated: boolean;
}

interface ViewPullRequestInput {
	run: GhRunner;
	checkout: string;
	head: string;
	pullRequestNumber: number | null;
	url?: string;
}

export async function runCheckedGh(
	run: GhRunner,
	args: readonly string[],
	cwd?: string,
): Promise<GhResult> {
	const result = await run(args, cwd === undefined ? {} : { cwd });
	if (result.code !== 0) throw GhError.fromStderr(result.stderr, result.code);
	return result;
}

export function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? ''
	);
}

export async function viewPullRequest(
	input: ViewPullRequestInput,
): Promise<PullRequestView | null> {
	const { run, checkout, head, pullRequestNumber, url } = input;
	const runView = async (target: string): Promise<PullRequestView | null> => {
		const result = await run(['pr', 'view', target, '--json', PR_VIEW_FIELDS], { cwd: checkout });
		if (result.code !== 0) {
			if (/no pull requests found|not found/iu.test(result.stderr)) return null;
			throw GhError.fromStderr(result.stderr, result.code);
		}
		return parseGhJson<PullRequestView>(result, 'gh pr view');
	};

	if (url) return runView(url);
	if (pullRequestNumber !== null) return runView(String(pullRequestNumber));
	const list = await run(
		['pr', 'list', '--head', head, '--state', 'all', '--limit', '1', '--json', PR_VIEW_FIELDS],
		{ cwd: checkout },
	);
	if (list.code !== 0) throw GhError.fromStderr(list.stderr, list.code);
	const rows = parseGhJson<PullRequestView[]>(list, 'gh pr list');
	return rows[0] ?? null;
}

export type PullRequestText = Readonly<{ open: boolean; title: string; body: string }>;

export async function viewPullRequestText(
	run: GhRunner,
	checkout: string,
	number: number,
): Promise<PullRequestText> {
	const result = await runCheckedGh(
		run,
		['pr', 'view', String(number), '--json', 'state,title,body'],
		checkout,
	);
	const view = parseGhJson<Record<string, unknown>>(result, 'gh pr view');
	return {
		open: view.state === 'OPEN',
		title: typeof view.title === 'string' ? view.title : '',
		body: typeof view.body === 'string' ? view.body : '',
	};
}

export function sameText(left: string, right: string): boolean {
	return left.replaceAll('\r\n', '\n').trim() === right.replaceAll('\r\n', '\n').trim();
}

export function notOpenStatus(head: string, base: string): PullRequestStatusDto {
	return {
		state: 'not_open',
		number: null,
		url: null,
		title: null,
		draft: null,
		headRef: head,
		baseRef: base,
		headSha: null,
		includesLocalHead: null,
		mergeable: null,
		mergeableState: null,
		behindBase: null,
		checksState: 'none',
		checks: [],
		viewerCanMerge: null,
		allowedMergeMethods: [],
		defaultMergeMethod: null,
		reviewDecision: null,
		unresolvedReviewThreadCount: null,
		updatedAt: null,
	};
}

export function mapPullRequestStatus(view: PullRequestView): PullRequestStatusDto {
	const checks = mapChecks(view.statusCheckRollup);
	const mergeable = typeof view.mergeable === 'string' ? view.mergeable : null;
	return {
		state: mapState(view.state),
		number: typeof view.number === 'number' ? view.number : null,
		url: textOrNull(view.url),
		title: textOrNull(view.title),
		draft: typeof view.isDraft === 'boolean' ? view.isDraft : null,
		headRef: textOrNull(view.headRefName) ?? '',
		baseRef: textOrNull(view.baseRefName) ?? '',
		headSha: textOrNull(view.headRefOid),
		includesLocalHead: null,
		mergeable: mergeable === 'MERGEABLE' ? true : mergeable === 'CONFLICTING' ? false : null,
		mergeableState: textOrNull(view.mergeStateStatus),
		behindBase: null,
		checksState: aggregateChecksState(checks),
		checks,
		viewerCanMerge: null,
		allowedMergeMethods: [],
		defaultMergeMethod: null,
		reviewDecision: mapReviewDecision(view.reviewDecision),
		unresolvedReviewThreadCount: null,
		updatedAt: textOrNull(view.updatedAt),
	};
}

function mapState(value: unknown): PullRequestStatusDto['state'] {
	if (value === 'OPEN') return 'open';
	if (value === 'CLOSED') return 'closed';
	if (value === 'MERGED') return 'merged';
	return 'not_open';
}

function mapReviewDecision(value: unknown): PullRequestStatusDto['reviewDecision'] {
	if (value === 'APPROVED') return 'approved';
	if (value === 'CHANGES_REQUESTED') return 'changes_requested';
	if (value === 'REVIEW_REQUIRED') return 'review_required';
	return null;
}

export function mapChecks(rollup: unknown): PullRequestCheckDto[] {
	if (!Array.isArray(rollup)) return [];
	return rollup.map((entry) => {
		const record = isRecord(entry) ? entry : {};
		const conclusion = textOrNull(record.conclusion);
		const contextState = textOrNull(record.state);
		return {
			name: textOrNull(record.name) ?? textOrNull(record.context) ?? '',
			appId: numberOrNull(record.appId ?? nested(record, ['app', 'id'])),
			state: textOrNull(record.status) ?? contextState ?? 'UNKNOWN',
			conclusion,
			required: typeof record.isRequired === 'boolean' ? record.isRequired : null,
			url: textOrNull(record.detailsUrl) ?? textOrNull(record.targetUrl),
			startedAt: textOrNull(record.startedAt),
			completedAt: textOrNull(record.completedAt),
			notStartedReason: null,
		};
	});
}

export async function withNotStartedReasons(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	checks: readonly PullRequestCheckDto[],
): Promise<PullRequestCheckDto[]> {
	return Promise.all(
		checks.map(async (check) => {
			const job =
				check.conclusion?.toUpperCase() === 'FAILURE'
					? ACTIONS_JOB_URL.exec(check.url ?? '')?.[1]
					: undefined;
			if (!job) return check;
			const annotations = await readAnnotations(run, checkout, repository, job);
			return { ...check, notStartedReason: checkNotStartedReason(annotations ?? []) };
		}),
	);
}

export function aggregateChecksState(
	checks: readonly PullRequestCheckDto[],
): PullRequestStatusDto['checksState'] {
	if (checks.length === 0) return 'none';
	let pending = false;
	let seen = false;
	for (const check of checks) {
		const state = (check.conclusion ?? check.state).toUpperCase();
		if (
			state === 'FAILURE' ||
			state === 'ERROR' ||
			state === 'CANCELLED' ||
			state === 'TIMED_OUT' ||
			state === 'STARTUP_FAILURE' ||
			state === 'ACTION_REQUIRED'
		) {
			return 'failed';
		}
		if (state === 'SUCCESS' || state === 'NEUTRAL' || state === 'SKIPPED') {
			seen = true;
			continue;
		}
		if (
			state === 'PENDING' ||
			state === 'QUEUED' ||
			state === 'IN_PROGRESS' ||
			state === 'WAITING' ||
			state === 'REQUESTED' ||
			state === 'EXPECTED'
		) {
			pending = true;
			seen = true;
			continue;
		}
	}
	if (pending) return 'pending';
	return seen ? 'success' : 'unknown';
}

export async function fetchCheckDiagnostics(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	number: number,
): Promise<CheckDiagnosticsDto> {
	const view = await viewPullRequest({ run, checkout, head: '', pullRequestNumber: number });
	if (!view) throw new Error(`Pull request #${number} was not found`);
	const headSha = textOrNull(view.headRefOid);
	if (!headSha) throw new Error(`Pull request #${number} has no head commit`);
	const checkRunsResult = await runCheckedGh(
		run,
		[
			'api',
			`repos/${repository.fullName}/commits/${headSha}/check-runs?per_page=100`,
			'--paginate',
		],
		checkout,
	);
	const checkRunsBody = parseGhJson<{ check_runs?: unknown }>(checkRunsResult, 'gh api check-runs');
	const checkRuns = await Promise.all(
		mapCheckRuns(checkRunsBody.check_runs)
			.slice(0, DIAGNOSTIC_PAGE_LIMIT)
			.map(async (checkRun) =>
				withLogExcerpt(
					run,
					checkout,
					repository,
					await withAnnotations(run, checkout, repository, checkRun),
				),
			),
	);
	const statusesResult = await runCheckedGh(
		run,
		['api', `repos/${repository.fullName}/commits/${headSha}/statuses?per_page=100`, '--paginate'],
		checkout,
	);
	const statusesBody = parseGhJson<unknown>(statusesResult, 'gh api statuses');
	const commitStatuses = mapCommitStatuses(statusesBody).slice(0, DIAGNOSTIC_PAGE_LIMIT);
	const checkRunsTruncated = mapCheckRuns(checkRunsBody.check_runs).length > DIAGNOSTIC_PAGE_LIMIT;
	return {
		checkRuns,
		checkRunsComplete: !checkRunsTruncated,
		commitStatuses,
		commitStatusesComplete: true,
		truncated: checkRunsTruncated,
	};
}

const ANNOTATED_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
const ANNOTATION_LIMIT = 50;

async function withAnnotations(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	checkRun: CheckRunDiagnosticDto,
): Promise<CheckRunDiagnosticDto> {
	if (checkRun.annotationsCount === 0 || !ANNOTATED_CONCLUSIONS.has(checkRun.conclusion ?? '')) {
		return checkRun;
	}
	const annotations = await readAnnotations(run, checkout, repository, String(checkRun.id));
	if (annotations === null) return checkRun;
	return {
		...checkRun,
		annotations,
		annotationsComplete: annotations.length >= checkRun.annotationsCount,
	};
}

async function readAnnotations(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	checkRunId: string,
): Promise<CheckAnnotationDto[] | null> {
	const result = await run(
		[
			'api',
			`repos/${repository.fullName}/check-runs/${checkRunId}/annotations?per_page=${ANNOTATION_LIMIT}`,
		],
		{ cwd: checkout },
	).catch(() => null);
	if (result?.code !== 0) return null;
	try {
		const raw: unknown = JSON.parse(result.stdout);
		return Array.isArray(raw) ? raw.flatMap(mapAnnotation) : [];
	} catch {
		return null;
	}
}

const ACTIONS_JOB_URL = /\/actions\/runs\/\d+\/job\/(\d+)/u;

async function withLogExcerpt(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	checkRun: CheckRunDiagnosticDto,
): Promise<CheckRunDiagnosticDto> {
	if (!ANNOTATED_CONCLUSIONS.has(checkRun.conclusion ?? '')) return checkRun;
	const job = ACTIONS_JOB_URL.exec(checkRun.detailsUrl ?? '')?.[1];
	if (!job) return checkRun;
	const result = await run(['api', `repos/${repository.fullName}/actions/jobs/${job}/logs`], {
		cwd: checkout,
	}).catch(() => null);
	if (result?.code !== 0) return checkRun;
	return { ...checkRun, logExcerpt: failedStepLogExcerpt(result.stdout) };
}

const LOG_EXCERPT_LINES = 80;
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/u;
const STEP_FAILED = '##[error]Process completed with exit code';

export function failedStepLogExcerpt(log: string): string | null {
	const lines = log.split(/\r?\n/u).map((line) => line.replace(LOG_TIMESTAMP, ''));
	const failed = lines.findIndex((line) => line.startsWith(STEP_FAILED));
	const end = failed === -1 ? lines.length : failed + 1;
	const tail = lines
		.slice(Math.max(0, end - LOG_EXCERPT_LINES), end)
		.filter((line) => line.trim() !== '');
	return tail.length === 0 ? null : tail.join('\n');
}

function mapAnnotation(raw: unknown): CheckAnnotationDto[] {
	if (!isRecord(raw)) return [];
	const level = raw.annotation_level;
	if (level !== 'notice' && level !== 'warning' && level !== 'failure') return [];
	return [
		{
			path: textOrNull(raw.path) ?? '',
			startLine: numberOrNull(raw.start_line) ?? 0,
			endLine: numberOrNull(raw.end_line) ?? numberOrNull(raw.start_line) ?? 0,
			startColumn: numberOrNull(raw.start_column),
			endColumn: numberOrNull(raw.end_column),
			level,
			title: textOrNull(raw.title),
			message: textOrNull(raw.message) ?? '',
			rawDetails: textOrNull(raw.raw_details),
		},
	];
}

function mapCheckRuns(raw: unknown): CheckRunDiagnosticDto[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		if (!isRecord(entry) || typeof entry.id !== 'number') return [];
		const output = nested(entry, ['output']);
		const outputRecord = isRecord(output) ? output : null;
		return [
			{
				id: entry.id,
				name: textOrNull(entry.name) ?? '',
				appId: numberOrNull(nested(entry, ['app', 'id'])) ?? 0,
				status: textOrNull(entry.status) ?? 'completed',
				conclusion: textOrNull(entry.conclusion),
				detailsUrl: textOrNull(entry.details_url),
				startedAt: textOrNull(entry.started_at),
				completedAt: textOrNull(entry.completed_at),
				outputTitle: textOrNull(outputRecord?.title),
				outputSummary: textOrNull(outputRecord?.summary),
				outputText: textOrNull(outputRecord?.text),
				annotationsCount: numberOrNull(outputRecord?.annotations_count) ?? 0,
				annotations: null,
				annotationsComplete: false,
				logExcerpt: null,
			},
		];
	});
}

function mapCommitStatuses(raw: unknown): CommitStatusDiagnosticDto[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		if (!isRecord(entry) || typeof entry.id !== 'number') return [];
		const state = entry.state === 'failure' || entry.state === 'error' ? entry.state : null;
		if (!state) return [];
		return [
			{
				id: entry.id,
				context: textOrNull(entry.context) ?? '',
				state,
				description: textOrNull(entry.description),
				targetUrl: textOrNull(entry.target_url),
				createdAt: textOrNull(entry.created_at) ?? '',
				updatedAt: textOrNull(entry.updated_at) ?? '',
			},
		];
	});
}

const REVIEW_FEEDBACK_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id isResolved isOutdated path line startLine diffSide startDiffSide subjectType
          comments(first: 100) { nodes { id body createdAt updatedAt author { login } } }
        }
      }
      reviews(last: 100) {
        pageInfo { hasNextPage }
        nodes { id body state submittedAt updatedAt author { login } }
      }
    }
  }
}`;

export async function fetchReviewFeedback(
	run: GhRunner,
	checkout: string,
	repository: ConnectedRepository,
	number: number,
): Promise<ReviewFeedbackDto> {
	const [owner, name] = repository.fullName.split('/');
	if (!owner || !name)
		throw new Error(`Repository ${repository.fullName} is not a GitHub repository`);
	const result = await runCheckedGh(
		run,
		[
			'api',
			'graphql',
			'-f',
			`query=${REVIEW_FEEDBACK_QUERY}`,
			'-F',
			`owner=${owner}`,
			'-F',
			`name=${name}`,
			'-F',
			`number=${number}`,
		],
		checkout,
	);
	const body = parseGhJson<Record<string, unknown>>(result, 'gh api graphql');
	const pullRequest = nested(nested(body, ['data']), ['repository', 'pullRequest']);
	if (!pullRequest) throw new Error(`Pull request #${number} was not found`);
	const threads = nested(pullRequest, ['reviewThreads']);
	const reviews = nested(pullRequest, ['reviews']);
	const threadNodes = arrayOf(nested(threads, ['nodes']));
	const reviewNodes = arrayOf(nested(reviews, ['nodes']));
	const unresolvedThreads = threadNodes
		.filter((thread) => !isRecord(thread) || thread.isResolved !== true)
		.map((thread) => mapReviewThread(thread));
	const requestedChangeReviews = reviewNodes
		.filter((review) => isRecord(review) && review.state === 'CHANGES_REQUESTED')
		.map((review) => mapRequestedChangeReview(review));
	const threadsIncomplete = nested(nested(threads, ['pageInfo']), ['hasNextPage']) === true;
	const reviewsIncomplete = nested(nested(reviews, ['pageInfo']), ['hasNextPage']) === true;
	return {
		unresolvedThreads,
		unresolvedThreadsComplete: !threadsIncomplete,
		requestedChangeReviews,
		requestedChangeReviewsComplete: !reviewsIncomplete,
		truncated: threadsIncomplete || reviewsIncomplete,
	};
}

const REPLY_TO_REVIEW_THREAD = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id }
  }
}`;

const RESOLVE_REVIEW_THREAD = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

export async function replyAndResolveReviewThreads(
	run: GhRunner,
	checkout: string,
	threadIds: readonly string[],
	reply: string,
): Promise<AddressedReviewThreadsDto> {
	const resolvedThreadIds: string[] = [];
	const failures: string[] = [];
	for (const threadId of threadIds) {
		try {
			await runCheckedGh(
				run,
				[
					'api',
					'graphql',
					'-f',
					`query=${REPLY_TO_REVIEW_THREAD}`,
					'-f',
					`threadId=${threadId}`,
					'-f',
					`body=${reply}`,
				],
				checkout,
			);
			await runCheckedGh(
				run,
				['api', 'graphql', '-f', `query=${RESOLVE_REVIEW_THREAD}`, '-f', `threadId=${threadId}`],
				checkout,
			);
			resolvedThreadIds.push(threadId);
		} catch (error) {
			failures.push(describeError(error));
		}
	}
	return { resolvedThreadIds, failures };
}

function mapReviewThread(raw: unknown): ReviewThreadDto {
	const record = isRecord(raw) ? raw : {};
	const comments = nested(record, ['comments', 'nodes']);
	return {
		id: textOrNull(record.id) ?? '',
		path: textOrNull(record.path) ?? '',
		line: numberOrNull(record.line),
		startLine: numberOrNull(record.startLine),
		side: record.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
		startSide:
			record.startDiffSide === 'LEFT' || record.startDiffSide === 'RIGHT'
				? record.startDiffSide
				: null,
		subjectType: record.subjectType === 'FILE' ? 'FILE' : 'LINE',
		outdated: record.isOutdated === true,
		comments: arrayOf(comments).map((comment) => mapReviewComment(comment)),
	};
}

function mapReviewComment(raw: unknown): ReviewCommentDto {
	const record = isRecord(raw) ? raw : {};
	return {
		id: textOrNull(record.id) ?? '',
		authorLogin: textOrNull(nested(record, ['author', 'login'])),
		body: textOrNull(record.body) ?? '',
		createdAt: textOrNull(record.createdAt) ?? '',
		updatedAt: textOrNull(record.updatedAt) ?? '',
	};
}

function mapRequestedChangeReview(raw: unknown): RequestedChangeReviewDto {
	const record = isRecord(raw) ? raw : {};
	return {
		id: textOrNull(record.id) ?? '',
		authorLogin: textOrNull(nested(record, ['author', 'login'])),
		body: textOrNull(record.body) ?? '',
		submittedAt: textOrNull(record.submittedAt) ?? '',
		updatedAt: textOrNull(record.updatedAt) ?? '',
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nested(value: unknown, path: readonly string[]): unknown {
	let current: unknown = value;
	for (const key of path) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

function arrayOf(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function textOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
