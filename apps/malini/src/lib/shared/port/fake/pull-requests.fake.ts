import type {
	CheckDiagnosticsDto,
	PullRequestMetadataDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
} from '$contract/repositories';
import type { FakeBridge } from './fake-bridge';
import { fakeGithubState, type FakeGithubState } from './repositories.fake';

type PullRequestReference = Readonly<{ repoId: string; pullRequestNumber: number }>;

export function installPullRequestsFake(bridge: FakeBridge): void {
	const github = fakeGithubState(bridge);
	const bodies = new Map<string, string>();

	bridge.define('pull-requests.status', async (input) =>
		statusFor(github, input.repoId, input.head, input.base ?? null),
	);

	bridge.define('pull-requests.create', async (input) => {
		const repo = requireRepository(github, input.repoId);
		const number = 100 + github.pullRequests.size;
		bodies.set(`${input.repoId}#${number}`, input.body ?? '');
		return store(github, input.repoId, {
			...statusFor(github, input.repoId, input.head, null),
			state: 'open',
			number,
			url: `https://github.com/${repo.fullName}/pull/${number}`,
			title: input.title,
			draft: Boolean(input.draft),
			baseRef: input.base ?? repo.defaultBranch,
			headSha: 'fake-head-sha',
			includesLocalHead: null,
			updatedAt: new Date().toISOString(),
		});
	});

	bridge.define('pull-requests.mark-ready', async (input) =>
		store(github, input.repoId, { ...findByNumber(github, input), draft: false }),
	);

	bridge.define('pull-requests.merge', async (input) => {
		const status = findByNumber(github, input);
		if (status.headSha && status.headSha !== input.expectedHeadSha) {
			throw new Error('Pull request head moved since it was last read');
		}
		return store(github, input.repoId, { ...status, state: 'merged', mergeable: null });
	});

	bridge.define('pull-requests.update-metadata', async (input): Promise<PullRequestMetadataDto> => {
		const status = findByNumber(github, input);
		if (status.state !== 'open') return { title: null, body: null };
		const key = `${input.repoId}#${input.pullRequestNumber}`;
		const owned = (current: string, update: typeof input.title): string | null =>
			update && current.trim() === update.expected.trim() ? update.next : null;
		const title = owned(status.title ?? '', input.title);
		const body = owned(bodies.get(key) ?? '', input.body);
		if (title !== null) store(github, input.repoId, { ...status, title });
		if (body !== null) bodies.set(key, body);
		return { title, body };
	});

	bridge.define('pull-requests.check-diagnostics', async (input): Promise<CheckDiagnosticsDto> => {
		findByNumber(github, input);
		return {
			checkRuns: [],
			checkRunsComplete: true,
			commitStatuses: [],
			commitStatusesComplete: true,
			truncated: false,
		};
	});

	bridge.define('pull-requests.review-feedback', async (input): Promise<ReviewFeedbackDto> => {
		findByNumber(github, input);
		return {
			unresolvedThreads: [],
			unresolvedThreadsComplete: true,
			requestedChangeReviews: [],
			requestedChangeReviewsComplete: true,
			truncated: false,
		};
	});

	bridge.define('pull-requests.resolve-addressed-review-threads', async () => ({
		resolvedThreadIds: [],
		failures: [],
	}));
}

function statusFor(
	github: FakeGithubState,
	repoId: string,
	head: string,
	base: string | null,
): PullRequestStatusDto {
	const known = github.pullRequests.get(pullRequestKey(repoId, head));
	if (known) return { ...known };
	const repo = requireRepository(github, repoId);
	return {
		state: 'not_open',
		number: null,
		url: null,
		title: null,
		draft: null,
		headRef: head,
		baseRef: base ?? repo.defaultBranch,
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

function requireRepository(
	github: FakeGithubState,
	repoId: string,
): FakeGithubState['clones'][number] {
	const repo = github.clones.find((candidate) => candidate.id === repoId);
	if (!repo) throw new Error(`Unknown repository: ${repoId}`);
	return repo;
}

function findByNumber(github: FakeGithubState, input: PullRequestReference): PullRequestStatusDto {
	for (const [key, status] of github.pullRequests) {
		if (key.startsWith(`${input.repoId}:`) && status.number === input.pullRequestNumber) {
			return { ...status };
		}
	}
	throw new Error(`Unknown pull request #${input.pullRequestNumber} for ${input.repoId}`);
}

function store(
	github: FakeGithubState,
	repoId: string,
	status: PullRequestStatusDto,
): PullRequestStatusDto {
	github.pullRequests.set(pullRequestKey(repoId, status.headRef), status);
	return { ...status };
}

function pullRequestKey(repoId: string, head: string): string {
	return `${repoId}:${head}`;
}
