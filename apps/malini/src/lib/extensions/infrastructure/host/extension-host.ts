import type {
	ExtensionAPI,
	ExtensionManifest,
	ExtensionLifecycleScope,
	ExtensionPullRequestContext,
	ExtensionPullRequestCheckDiagnostics,
	ExtensionPullRequestCreateInput,
	ExtensionPullRequestDiagnosticsQuery,
	ExtensionPullRequestMergeInput,
	ExtensionPullRequestMetadata,
	ExtensionPullRequestMetadataUpdate,
	ExtensionPullRequestQuery,
	ExtensionPullRequestReadyForReviewInput,
	ExtensionRestartOnBaseInput,
	ExtensionPullRequestReviewFeedback,
	ExtensionWorkstreamEnsureInput,
	ExtensionWorkstreamNavigationInput,
	ExtensionWorkstreamSummary,
	ExtensionWorkstream,
} from '@malini/extension-api';

import type { WorkstreamSnapshotReader } from '$shared/repositories/repositories.api';

import type {
	ExtensionSettingStorage,
	ExtensionStateStorage,
} from '../../domain/extension-storage';
import type { InspectorPanelRegistry } from '../stores/inspector-panel-registry.store.svelte';
import { DesktopExtensionContributionHost } from './contributions.adapter';
import { createDesktopExtensionRepository } from './repository.adapter';
import { createDesktopExtensionState } from './state.adapter';
import {
	createDesktopExtensionClock,
	createDesktopExtensionIds,
	createDesktopExtensionNotifications,
	createDesktopExtensionSecrets,
	createDesktopExtensionUI,
} from './utilities.adapter';
import { createDesktopExtensionWorkstream } from './workstream.adapter';

type DesktopExtensionHostOptions = {
	workstream: () => ExtensionWorkstream | null;
	knownWorkstreams?: () => readonly ExtensionWorkstream[];
	workstreamSnapshots: WorkstreamSnapshotReader;
	contributions?: DesktopExtensionContributionHost;
	panelRegistry?: InspectorPanelRegistry;
	settingStorage?: ExtensionSettingStorage;
	stateStorage?: ExtensionStateStorage | null;
	nextId?: () => string;
	pullRequest?: (
		workstreamId: string,
		query?: ExtensionPullRequestQuery,
	) => Promise<ExtensionPullRequestContext>;
	createPullRequest?: (
		workstreamId: string,
		request: ExtensionPullRequestCreateInput,
	) => Promise<ExtensionPullRequestContext>;
	markPullRequestReadyForReview?: (
		workstreamId: string,
		request: ExtensionPullRequestReadyForReviewInput,
	) => Promise<ExtensionPullRequestContext>;
	mergePullRequest?: (
		workstreamId: string,
		request: ExtensionPullRequestMergeInput,
	) => Promise<ExtensionPullRequestContext>;
	updatePullRequestMetadata?: (
		workstreamId: string,
		request: ExtensionPullRequestMetadataUpdate,
	) => Promise<ExtensionPullRequestMetadata>;
	pullRequestReviewFeedback?: (
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	) => Promise<ExtensionPullRequestReviewFeedback>;
	pullRequestCheckDiagnostics?: (
		workstreamId: string,
		request: ExtensionPullRequestDiagnosticsQuery,
	) => Promise<ExtensionPullRequestCheckDiagnostics>;
	pushRepository?: (workstreamId: string) => Promise<string>;
	pullRepository?: (workstreamId: string, baseBranch: string) => Promise<string>;
	restartRepositoryOnBase?: (
		workstreamId: string,
		request: ExtensionRestartOnBaseInput,
	) => Promise<string>;
	refreshRepository?: (workstreamId: string) => Promise<void>;
	listWorkstreams?: () => Promise<readonly ExtensionWorkstreamSummary[]>;
	ensureWorkstream?: (input: ExtensionWorkstreamEnsureInput) => Promise<ExtensionWorkstreamSummary>;
	openWorkstream?: (input: ExtensionWorkstreamNavigationInput) => Promise<void>;
};

export class DesktopExtensionHost {
	readonly contributions: DesktopExtensionContributionHost;
	readonly #options: DesktopExtensionHostOptions;

	constructor(options: DesktopExtensionHostOptions) {
		this.#options = options;
		this.contributions =
			options.contributions ??
			new DesktopExtensionContributionHost({
				...(options.panelRegistry ? { panelRegistry: options.panelRegistry } : {}),
				...(options.settingStorage ? { settingStorage: options.settingStorage } : {}),
				currentWorkstream: options.workstream,
			});
	}

	createAPI = (manifest: ExtensionManifest, lifecycle: ExtensionLifecycleScope): ExtensionAPI => {
		const knownWorkstreams = this.#options.knownWorkstreams;
		const workstream = createDesktopExtensionWorkstream({
			extensionId: manifest.id,
			workstream: this.#options.workstream,
			...(knownWorkstreams ? { knownWorkstreams } : {}),
		});
		const repository = createDesktopExtensionRepository({
			workstream: this.#options.workstream,
			...(knownWorkstreams ? { knownWorkstreams } : {}),
			snapshots: this.#options.workstreamSnapshots,
			...(this.#options.pullRequest ? { pullRequest: this.#options.pullRequest } : {}),
			...(this.#options.createPullRequest
				? { createPullRequest: this.#options.createPullRequest }
				: {}),
			...(this.#options.markPullRequestReadyForReview
				? { markPullRequestReadyForReview: this.#options.markPullRequestReadyForReview }
				: {}),
			...(this.#options.mergePullRequest
				? { mergePullRequest: this.#options.mergePullRequest }
				: {}),
			...(this.#options.updatePullRequestMetadata
				? { updatePullRequestMetadata: this.#options.updatePullRequestMetadata }
				: {}),
			...(this.#options.pullRequestReviewFeedback
				? { pullRequestReviewFeedback: this.#options.pullRequestReviewFeedback }
				: {}),
			...(this.#options.pullRequestCheckDiagnostics
				? { pullRequestCheckDiagnostics: this.#options.pullRequestCheckDiagnostics }
				: {}),
			...(this.#options.pushRepository ? { push: this.#options.pushRepository } : {}),
			...(this.#options.pullRepository ? { pull: this.#options.pullRepository } : {}),
			...(this.#options.restartRepositoryOnBase
				? { restartOnBase: this.#options.restartRepositoryOnBase }
				: {}),
			...(this.#options.refreshRepository ? { refresh: this.#options.refreshRepository } : {}),
		});
		const contributionAPI = this.contributions.createAPI(manifest, lifecycle);
		const state = createDesktopExtensionState({
			extensionId: manifest.id,
			...(this.#options.stateStorage !== undefined ? { storage: this.#options.stateStorage } : {}),
		});
		const ids = createDesktopExtensionIds(this.#options.nextId);
		return {
			manifest,
			workstream,
			repository,
			panels: contributionAPI.panels,
			commands: contributionAPI.commands,
			settings: contributionAPI.settings,
			state,
			workflows: contributionAPI.workflows,
			events: contributionAPI.events,
			notifications: createDesktopExtensionNotifications(),
			clock: createDesktopExtensionClock(),
			ids,
			ui: createDesktopExtensionUI(),
			...(this.#options.listWorkstreams && this.#options.openWorkstream
				? {
						navigation: {
							listWorkstreams: this.#options.listWorkstreams,
							...(this.#options.ensureWorkstream
								? { ensureWorkstream: this.#options.ensureWorkstream }
								: {}),
							openWorkstream: this.#options.openWorkstream,
						},
					}
				: {}),
			secrets: createDesktopExtensionSecrets({
				extensionId: manifest.id,
				...(this.#options.stateStorage ? { storage: this.#options.stateStorage } : {}),
			}),
			subscriptions: contributionAPI.subscriptions,
		};
	};
}
