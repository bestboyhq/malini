import type {
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestContext,
	ExtensionPullRequestCreateInput,
	ExtensionPullRequestDiagnosticsQuery,
	ExtensionPullRequestMergeInput,
	ExtensionPullRequestMetadata,
	ExtensionPullRequestMetadataUpdate,
	ExtensionPullRequestQuery,
	ExtensionPullRequestReadyForReviewInput,
	ExtensionPullRequestReviewFeedback,
} from '@malini/extension-api';
import type { ExtensionRepositoryBinding } from '$shared/extensions/bindings';
import {
	PERFORMANCE_BUDGETS,
	runtimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';
import type { PlatformBridge } from '$shared/port/bridge';
import { invoke } from '$shared/port/invoke';
import { platformBridge } from '$shared/port/platform';
import {
	GitHubAuthRequiredError,
	isGitHubAuthRequiredError,
} from '$shared/repositories/domain/github-auth';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
	repositoryContextForWorkstream,
	supportsRemotePullRequests,
	type ConnectedRepositoryContext,
} from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { ExtensionPullRequestMapper } from '$shared/repositories/infrastructure/mappers/extension-pull-request.mapper';
import { PullRequestReads } from '$shared/repositories/infrastructure/services/pull-request-reads.service';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

type ResolvedRepository = Readonly<{
	workstream: Workstream;
	context: ConnectedRepositoryContext;
}>;

type ResolvedRepositoryContext = Readonly<{
	workstream: Workstream;
	context: ConnectedRepositoryContext | null;
}>;

export class ExtensionRepositoryBindingService implements ExtensionRepositoryBinding {
	readonly #now: () => number;
	readonly #pullRequestReadsByBridge = new WeakMap<PlatformBridge, PullRequestReads>();

	constructor(now: () => number = () => Date.now()) {
		this.#now = now;
	}

	async pullRequest(
		workstreamId: string,
		query?: ExtensionPullRequestQuery,
	): Promise<ExtensionPullRequestContext> {
		const { workstream, context } = resolveRepositoryContext(workstreamId);
		if (!context || !supportsRemotePullRequests(context.repo)) {
			return ExtensionPullRequestMapper.unavailable(workstream);
		}
		const target = {
			workstreamId,
			repoId: context.repo.id,
			head: workstream.branch,
			base: workstream.baseBranch || context.repo.defaultBranch,
		};
		try {
			const status = await this.#pullRequestReads().read(
				{
					workstreamId,
					head: target.head,
					base: target.base,
					pullRequestNumber: query?.pullRequestNumber ?? null,
				},
				query?.maxAgeMs,
				() =>
					measureRepositoryRead('Checking pull request', workstreamId, () =>
						withGitHubAuth(() =>
							invoke('pull-requests.status', {
								...target,
								...(query?.pullRequestNumber === undefined
									? {}
									: { pullRequestNumber: query.pullRequestNumber }),
							}),
						),
					),
			);
			return ExtensionPullRequestMapper.fromRaw(status);
		} catch (error) {
			if (isGitHubAuthRequiredError(error)) {
				return ExtensionPullRequestMapper.unavailable(workstream);
			}
			throw error;
		}
	}

	createPullRequest(
		workstreamId: string,
		request: ExtensionPullRequestCreateInput,
	): Promise<ExtensionPullRequestContext> {
		return this.#mutatePullRequest('Creating pull request', workstreamId, async () => {
			const resolved = resolveRemoteRepository(
				workstreamId,
				'Pull requests are unavailable for this repository',
			);
			const status = await withGitHubAuth(() =>
				invoke('pull-requests.create', {
					workstreamId,
					repoId: resolved.context.repo.id,
					head: resolved.workstream.branch,
					base:
						request.baseBranch ??
						resolved.workstream.baseBranch ??
						resolved.context.repo.defaultBranch,
					title: request.title,
					body: request.body ?? `Created from malini for ${resolved.context.repo.fullName}.`,
					draft: request.draft ?? false,
				}),
			);
			return ExtensionPullRequestMapper.fromRaw(status);
		});
	}

	markPullRequestReadyForReview(
		workstreamId: string,
		request: ExtensionPullRequestReadyForReviewInput,
	): Promise<ExtensionPullRequestContext> {
		return this.#mutatePullRequest('Marking pull request ready', workstreamId, async () => {
			const resolved = resolveRemoteRepository(
				workstreamId,
				'Pull request updates are unavailable for this repository',
			);
			const status = await withGitHubAuth(() =>
				invoke('pull-requests.mark-ready', {
					workstreamId,
					repoId: resolved.context.repo.id,
					pullRequestNumber: request.number,
				}),
			);
			return ExtensionPullRequestMapper.fromRaw(status);
		});
	}

	mergePullRequest(
		workstreamId: string,
		request: ExtensionPullRequestMergeInput,
	): Promise<ExtensionPullRequestContext> {
		return this.#mutatePullRequest('Merging pull request', workstreamId, async () => {
			const resolved = resolveRemoteRepository(
				workstreamId,
				'Pull request merging is unavailable for this repository',
			);
			const status = await withGitHubAuth(() =>
				invoke('pull-requests.merge', {
					workstreamId,
					repoId: resolved.context.repo.id,
					pullRequestNumber: request.number,
					...(request.mergeMethod === undefined ? {} : { mergeMethod: request.mergeMethod }),
					expectedHeadSha: request.expectedHeadSha,
				}),
			);
			return ExtensionPullRequestMapper.fromRaw(status);
		});
	}

	updatePullRequestMetadata(
		workstreamId: string,
		request: ExtensionPullRequestMetadataUpdate,
	): Promise<ExtensionPullRequestMetadata> {
		return this.#mutatePullRequest('Updating pull request text', workstreamId, async () => {
			const resolved = resolveRemoteRepository(
				workstreamId,
				'Pull request updates are unavailable for this repository',
			);
			return withGitHubAuth(() =>
				invoke('pull-requests.update-metadata', {
					workstreamId,
					repoId: resolved.context.repo.id,
					pullRequestNumber: request.number,
					...(request.title ? { title: request.title } : {}),
					...(request.body ? { body: request.body } : {}),
				}),
			);
		});
	}

	pullRequestReviewFeedback(
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	): Promise<ExtensionPullRequestReviewFeedback> {
		return measureRepositoryRead('Reading pull request review feedback', workstreamId, async () => {
			const resolved = resolveRepository(workstreamId);
			const feedback = await withGitHubAuth(() =>
				invoke('pull-requests.review-feedback', {
					workstreamId,
					repoId: resolved.context.repo.id,
					pullRequestNumber: request.number,
				}),
			);
			return ExtensionPullRequestMapper.reviewFeedbackFromRaw(feedback);
		});
	}

	pullRequestCheckDiagnostics(
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	): Promise<ExtensionPullRequestCheckDiagnostics> {
		return measureRepositoryRead(
			'Reading pull request check diagnostics',
			workstreamId,
			async () => {
				const resolved = resolveRepository(workstreamId);
				const diagnostics = await withGitHubAuth(() =>
					invoke('pull-requests.check-diagnostics', {
						workstreamId,
						repoId: resolved.context.repo.id,
						pullRequestNumber: request.number,
					}),
				);
				return ExtensionPullRequestMapper.checkDiagnosticsFromRaw(diagnostics);
			},
		);
	}

	pushRepository(workstreamId: string): Promise<string> {
		return this.#mutatePullRequest('Pushing branch', workstreamId, async () => {
			const resolved = resolveRepository(workstreamId);
			return workstreamsService.push(workstreamId, resolved.context.repo.fullName);
		});
	}

	pullRepository(workstreamId: string, baseBranch: string): Promise<string> {
		return this.#mutatePullRequest('Pulling base branch', workstreamId, async () => {
			resolveRepository(workstreamId);
			return workstreamsService.pull(workstreamId, baseBranch);
		});
	}

	async refreshRepository(workstreamId: string): Promise<void> {
		await measureRepositoryRead('Reading repository worktree status', workstreamId, async () => {
			resolveRepositoryContext(workstreamId);
			await workstreamsService.gitStatus(workstreamId);
		});
	}

	#pullRequestReads(): PullRequestReads {
		const bridge = platformBridge();
		const existing = this.#pullRequestReadsByBridge.get(bridge);
		if (existing) return existing;
		const reads = new PullRequestReads(this.#now);
		this.#pullRequestReadsByBridge.set(bridge, reads);
		return reads;
	}

	async #mutatePullRequest<T>(
		label: string,
		workstreamId: string,
		mutation: () => Promise<T>,
	): Promise<T> {
		this.#pullRequestReads().forget(workstreamId);
		try {
			return await measureRepositoryMutation(label, workstreamId, mutation);
		} finally {
			this.#pullRequestReads().forget(workstreamId);
		}
	}
}

export const extensionRepositoryBindingService = new ExtensionRepositoryBindingService();

function measureRepositoryRead<T>(
	label: string,
	workstreamId: string,
	operation: () => Promise<T>,
): Promise<T> {
	return runtimeDiagnostics.measure(
		{
			category: 'repository',
			label,
			budgetMs: PERFORMANCE_BUDGETS.repositoryReadMs,
			target: workstreamId,
		},
		operation,
	);
}

function measureRepositoryMutation<T>(
	label: string,
	workstreamId: string,
	operation: () => Promise<T>,
): Promise<T> {
	return runtimeDiagnostics.measure(
		{
			category: 'repository',
			label,
			budgetMs: PERFORMANCE_BUDGETS.repositoryMutationMs,
			target: workstreamId,
		},
		operation,
	);
}

function resolveRemoteRepository(workstreamId: string, unsupported: string): ResolvedRepository {
	const resolved = resolveRepository(workstreamId);
	if (!supportsRemotePullRequests(resolved.context.repo)) throw new Error(unsupported);
	return resolved;
}

function resolveRepository(workstreamId: string): ResolvedRepository {
	const resolved = resolveRepositoryContext(workstreamId);
	if (!resolved.context) {
		throw new Error(`No repository is connected to workstream ${workstreamId}`);
	}
	return { workstream: resolved.workstream, context: resolved.context };
}

function resolveRepositoryContext(workstreamId: string): ResolvedRepositoryContext {
	if (!workstreamsAggregate.loaded) {
		throw new Error('Extension repository context is still loading');
	}
	const workstream = workstreamsAggregate.workstreams.find(
		(candidate) => candidate.id === workstreamId,
	);
	if (!workstream) throw new Error(`Unknown workstream: ${workstreamId}`);
	const repositories = mergeRepositories(
		repositoriesAggregate.items,
		localRepositoriesFromProjects(workstreamsAggregate.projects),
	);
	const context = repositoryContextForWorkstream({
		repositories,
		workstreams: workstreamsAggregate.workstreams,
		workstreamId,
	});
	return { workstream, context };
}

async function withGitHubAuth<T>(request: () => Promise<T>): Promise<T> {
	try {
		return await request();
	} catch (error) {
		if (isGitHubAuthRequiredError(error)) {
			throw new GitHubAuthRequiredError(error instanceof Error ? error.message : String(error));
		}
		throw error;
	}
}
