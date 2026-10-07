import type {
	ExtensionPullRequestContext,
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestCreateInput,
	ExtensionPullRequestDiagnosticsQuery,
	ExtensionPullRequestMergeInput,
	ExtensionPullRequestMetadata,
	ExtensionPullRequestMetadataUpdate,
	ExtensionPullRequestQuery,
	ExtensionPullRequestReadyForReviewInput,
	ExtensionPullRequestReviewFeedback,
	ExtensionRestartOnBaseInput,
	ExtensionWorkstreamEnsureInput,
	ExtensionWorkstreamNavigationInput,
	ExtensionWorkstreamSummary,
} from '@malini/extension-api';

export type ExtensionRepositoryBinding = Readonly<{
	pullRequest(
		workstreamId: string,
		query?: ExtensionPullRequestQuery,
	): Promise<ExtensionPullRequestContext>;
	createPullRequest(
		workstreamId: string,
		request: ExtensionPullRequestCreateInput,
	): Promise<ExtensionPullRequestContext>;
	markPullRequestReadyForReview(
		workstreamId: string,
		request: ExtensionPullRequestReadyForReviewInput,
	): Promise<ExtensionPullRequestContext>;
	mergePullRequest(
		workstreamId: string,
		request: ExtensionPullRequestMergeInput,
	): Promise<ExtensionPullRequestContext>;
	updatePullRequestMetadata(
		workstreamId: string,
		request: ExtensionPullRequestMetadataUpdate,
	): Promise<ExtensionPullRequestMetadata>;
	pullRequestReviewFeedback(
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	): Promise<ExtensionPullRequestReviewFeedback>;
	pullRequestCheckDiagnostics(
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	): Promise<ExtensionPullRequestCheckDiagnostics>;
	pushRepository(workstreamId: string): Promise<string>;
	pullRepository(workstreamId: string, baseBranch: string): Promise<string>;
	restartRepositoryOnBase(
		workstreamId: string,
		request: ExtensionRestartOnBaseInput,
	): Promise<string>;
	refreshRepository(workstreamId: string): Promise<void>;
}>;

export type ExtensionNavigationBinding = Readonly<{
	listWorkstreams(): Promise<readonly ExtensionWorkstreamSummary[]>;
	ensureWorkstream(input: ExtensionWorkstreamEnsureInput): Promise<ExtensionWorkstreamSummary>;
	openWorkstream(input: ExtensionWorkstreamNavigationInput): Promise<void>;
}>;

class ExtensionBindings {
	#repository: ExtensionRepositoryBinding | null = null;
	#navigation: ExtensionNavigationBinding | null = null;

	bindRepository(binding: ExtensionRepositoryBinding): () => void {
		this.#repository = binding;
		return () => {
			if (this.#repository === binding) this.#repository = null;
		};
	}

	bindNavigation(binding: ExtensionNavigationBinding): () => void {
		this.#navigation = binding;
		return () => {
			if (this.#navigation === binding) this.#navigation = null;
		};
	}

	repository(): ExtensionRepositoryBinding {
		if (!this.#repository) {
			throw new Error('The extension repository bridge is unavailable outside a workstream');
		}
		return this.#repository;
	}

	navigation(): ExtensionNavigationBinding {
		if (!this.#navigation) {
			throw new Error('The extension navigation bridge is unavailable outside a workstream');
		}
		return this.#navigation;
	}

	clear(): void {
		this.#repository = null;
		this.#navigation = null;
	}
}

export const extensionBindings = new ExtensionBindings();
