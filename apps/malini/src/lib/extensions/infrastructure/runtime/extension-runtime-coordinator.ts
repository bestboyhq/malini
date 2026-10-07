import type { ExtensionActivationReport, ExtensionWorkstream } from '@malini/extension-api';
import type { WorkstreamSnapshotReader } from '$shared/repositories/repositories.api';
import {
	PERFORMANCE_BUDGETS,
	runtimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';

import { extensionBindings } from '$shared/extensions/bindings';

import { extensionRuntimeFailureDiagnostic } from '../../domain/extension-runtime-failure';
import type { WorkstreamCreatedAutomationContext } from '../../domain/workstream-created-automation-context';
import { InspectorPanelRegistry } from '../stores/inspector-panel-registry.store.svelte';
import { WorkstreamExtensions } from './workstream-extensions';

type RepositoryOption =
	| 'pullRequest'
	| 'createPullRequest'
	| 'markPullRequestReadyForReview'
	| 'mergePullRequest'
	| 'updatePullRequestMetadata'
	| 'pullRequestReviewFeedback'
	| 'pullRequestCheckDiagnostics'
	| 'pushRepository'
	| 'pullRepository'
	| 'restartRepositoryOnBase'
	| 'refreshRepository';

type NavigationOption = 'listWorkstreams' | 'ensureWorkstream' | 'openWorkstream';

type ExtensionRuntimeOptions = Omit<
	ConstructorParameters<typeof WorkstreamExtensions>[0],
	RepositoryOption | NavigationOption | 'contributions' | 'panelRegistry'
>;

const EMPTY_ACTIVATION_REPORT: ExtensionActivationReport = {
	activated: [],
	failed: [],
	skipped: [],
};

export class ExtensionRuntimeCoordinator {
	readonly inspectorPanels: InspectorPanelRegistry;
	#workstreamSnapshots: WorkstreamSnapshotReader | null = null;
	#service: WorkstreamExtensions | null = null;
	#pendingActivationFailures: {
		workstream: ExtensionWorkstream;
		report: ExtensionActivationReport;
	} | null = null;
	readonly #creationAnnouncements = new Map<string, Promise<void>>();
	#transition: Promise<void>;

	constructor(
		startupBarrier: Promise<unknown> = Promise.resolve(),
		inspectorPanels = new InspectorPanelRegistry(),
	) {
		this.inspectorPanels = inspectorPanels;
		this.#transition = settled(startupBarrier);
	}

	get service(): WorkstreamExtensions | null {
		return this.#service;
	}

	initialize(options: ExtensionRuntimeOptions): WorkstreamExtensions {
		if (this.#service) return this.#service;
		this.#workstreamSnapshots = options.workstreamSnapshots;
		this.#service = new WorkstreamExtensions({
			...options,
			panelRegistry: this.inspectorPanels,
			listWorkstreams: () => extensionBindings.navigation().listWorkstreams(),
			ensureWorkstream: (input) => extensionBindings.navigation().ensureWorkstream(input),
			openWorkstream: (input) => extensionBindings.navigation().openWorkstream(input),
			pullRequest: (workstreamId, query) =>
				extensionBindings.repository().pullRequest(workstreamId, query),
			createPullRequest: (workstreamId, request) =>
				extensionBindings.repository().createPullRequest(workstreamId, request),
			markPullRequestReadyForReview: (workstreamId, request) =>
				extensionBindings.repository().markPullRequestReadyForReview(workstreamId, request),
			mergePullRequest: (workstreamId, request) =>
				extensionBindings.repository().mergePullRequest(workstreamId, request),
			updatePullRequestMetadata: (workstreamId, request) =>
				extensionBindings.repository().updatePullRequestMetadata(workstreamId, request),
			pullRequestReviewFeedback: (workstreamId, request) =>
				extensionBindings.repository().pullRequestReviewFeedback(workstreamId, request),
			pullRequestCheckDiagnostics: (workstreamId, request) =>
				extensionBindings.repository().pullRequestCheckDiagnostics(workstreamId, request),
			pushRepository: (workstreamId) => extensionBindings.repository().pushRepository(workstreamId),
			pullRepository: (workstreamId, baseBranch) =>
				extensionBindings.repository().pullRepository(workstreamId, baseBranch),
			restartRepositoryOnBase: (workstreamId, request) =>
				extensionBindings.repository().restartRepositoryOnBase(workstreamId, request),
			refreshRepository: (workstreamId) =>
				extensionBindings.repository().refreshRepository(workstreamId),
		});
		return this.#service;
	}

	activate(
		workstream: ExtensionWorkstream,
		options: { recoveryMode?: boolean; onStarted?: () => void } = {},
	): Promise<ExtensionActivationReport> {
		const fromWorkstreamId = this.#service?.workstream?.id ?? null;
		const operation = fromWorkstreamId === null ? 'startup' : 'workstream-transition';
		return runtimeDiagnostics
			.measure(
				{
					category: 'extension',
					label: this.#service?.workstream ? 'Switching extensions' : 'Starting extensions',
					budgetMs: PERFORMANCE_BUDGETS.extensionActivationMs,
					target: workstream.id,
				},
				() =>
					this.#enqueue(async () => {
						options.onStarted?.();
						const service = this.#requireService();
						if (!service.workstream) {
							return this.#recordActivationReport(
								workstream,
								await service.start(workstream, options),
							);
						}
						if (!sameWorkstream(service.workstream, workstream)) {
							return this.#recordActivationReport(
								workstream,
								await service.setWorkstream(workstream),
							);
						}
						return this.#retryPendingActivationFailures(service, workstream);
					}),
			)
			.catch((error) => {
				console.error(
					'[malini extensions] runtime activation failed',
					extensionRuntimeFailureDiagnostic({
						operation,
						fromWorkstreamId,
						toWorkstreamId: workstream.id,
						error,
					}),
				);
				throw error;
			});
	}

	reloadWorkstreamConfiguration(
		workstream: ExtensionWorkstream,
	): Promise<ExtensionActivationReport> {
		return this.#enqueue(async () => {
			const service = this.#requireService();
			if (!service.workstream) {
				return this.#recordActivationReport(workstream, await service.start(workstream));
			}
			if (!sameWorkstream(service.workstream, workstream)) {
				throw new Error('The active repository changed before its extension settings were saved');
			}
			return this.#recordActivationReport(workstream, await service.setWorkstream(workstream));
		});
	}

	async whenIdle(): Promise<void> {
		await this.#transition;
	}

	reloadRoutines(): Promise<void> {
		return this.#enqueue(async () => {
			await this.#service?.reloadRoutines();
		});
	}

	announceWorkstreamCreated(
		workstreamId: string,
		context: WorkstreamCreatedAutomationContext = {},
	): Promise<void> {
		const existing = this.#creationAnnouncements.get(workstreamId);
		if (existing) return existing;
		const service = this.#requireService();
		const announcement = service.announceWorkstreamCreated(workstreamId, context);
		this.#creationAnnouncements.set(workstreamId, announcement);
		void settled(announcement).finally(() => this.#creationAnnouncements.delete(workstreamId));
		return announcement;
	}

	announceWorkstreamArchived(workstreamId: string): Promise<void> {
		return this.#service?.announceWorkstreamArchived(workstreamId) ?? Promise.resolve();
	}

	announceWorkstreamDeleted(workstreamId: string): Promise<void> {
		return this.#service?.announceWorkstreamDeleted(workstreamId) ?? Promise.resolve();
	}

	stop(): Promise<void> {
		return this.#enqueue(async () => {
			const service = this.#service;
			try {
				if (service) await service.stop();
			} finally {
				this.inspectorPanels.clear();
				this.#workstreamSnapshots?.clear();
				this.#service = null;
				this.#pendingActivationFailures = null;
				this.#creationAnnouncements.clear();
			}
		});
	}

	async #retryPendingActivationFailures(
		service: WorkstreamExtensions,
		workstream: ExtensionWorkstream,
	): Promise<ExtensionActivationReport> {
		const pending = this.#pendingActivationFailures;
		if (!pending || !sameWorkstream(pending.workstream, workstream)) return EMPTY_ACTIVATION_REPORT;

		const retryBundled = pending.report.failed.some(({ id }) => {
			const record = service.runtime.registry.get(id);
			return record !== null && record.state !== 'active';
		});

		if (!retryBundled) {
			return this.#recordActivationReport(workstream, EMPTY_ACTIVATION_REPORT);
		}

		const retried = await service.setWorkstream(workstream);
		return this.#recordActivationReport(workstream, retried);
	}

	#recordActivationReport(
		workstream: ExtensionWorkstream,
		report: ExtensionActivationReport,
	): ExtensionActivationReport {
		this.#pendingActivationFailures =
			report.failed.length > 0 ? { workstream: { ...workstream }, report } : null;
		for (const failure of report.failed) {
			console.error(
				`[malini extensions] ${failure.id} did not activate for workstream ${workstream.id}`,
				failure.error,
			);
		}
		return report;
	}

	#requireService(): WorkstreamExtensions {
		if (!this.#service) throw new Error('Desktop extension runtime is not initialized');
		return this.#service;
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const prior = this.#transition;
		const result = (async () => {
			await settled(prior);
			return operation();
		})();
		this.#transition = settled(result);
		return result;
	}
}

async function settled(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch {
		return;
	}
}

function sameWorkstream(left: ExtensionWorkstream, right: ExtensionWorkstream): boolean {
	return (
		left.id === right.id &&
		left.path === right.path &&
		left.repositoryPath === right.repositoryPath &&
		left.repositoryRootPath === right.repositoryRootPath &&
		left.repositoryFullName === right.repositoryFullName &&
		left.branch === right.branch &&
		left.baseBranch === right.baseBranch
	);
}
