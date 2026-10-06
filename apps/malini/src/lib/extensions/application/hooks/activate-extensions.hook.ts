import type { ExtensionWorkstream } from '@malini/extension-api';
import { untrack } from 'svelte';
import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { extensionWorkstreamFingerprint } from '../../domain/extension-workstream-fingerprint';
import type { WorkstreamCreatedAutomationContext } from '../../domain/workstream-created-automation-context';
import {
	EXTENSION_WORKSTREAM_READINESS_DEADLINE_MS,
	ExtensionWorkstreamReadinessDeadline,
} from '../../infrastructure/runtime/extension-readiness-deadline';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { dismissExtensionReadinessToastCommand } from '../commands/dismiss-extension-readiness-toast.command';
import { publishAutomationRunOptionsCommand } from '../commands/publish-automation-run-options.command';

type ExtensionActivationRequest = Readonly<{
	workstream: ExtensionWorkstream;
	currentWorkstreamId: () => string;
	creationContext: WorkstreamCreatedAutomationContext | null;
	onCreationAnnounced: (workstreamId: string) => void;
}>;

export function activateExtensionsHook(): (request: ExtensionActivationRequest) => () => void {
	return (request) => {
		if (!extensionRuntimeStore.service) return () => {};
		return untrack(() => requestActivation(request));
	};
}

function requestActivation(request: ExtensionActivationRequest): () => void {
	const { workstream } = request;
	const coordinator = extensionRuntimeStore.coordinator();
	const fingerprint = extensionWorkstreamFingerprint(workstream);
	if (
		fingerprint === extensionRuntimeStore.requestedWorkstreamFingerprint &&
		!extensionRuntimeStore.requestedInBackground
	) {
		return () => {};
	}
	extensionRuntimeStore.requestedWorkstreamFingerprint = fingerprint;
	extensionRuntimeStore.requestedInBackground = false;
	const generation = ++extensionRuntimeStore.activationGeneration;
	extensionRuntimeStore.ready = false;
	extensionRuntimeStore.error = null;
	readinessDeadline(request.currentWorkstreamId).defer(workstream.id);

	const cancelActivationRelease = scheduleAfterSettledNavigationPaint(() => {
		if (!isCurrent(generation, workstream.id, request)) return;
		void (async () => {
			try {
				const report = await coordinator.activate(workstream, {
					recoveryMode: recoveryModeEnabled(),
					onStarted: () => {
						if (!isCurrent(generation, workstream.id, request)) return;
						readinessDeadline(request.currentWorkstreamId).start(workstream.id);
					},
				});
				commitActiveWorkstream();
				if (generation !== extensionRuntimeStore.activationGeneration) return;
				extensionRuntimeStore.workstreamRevision += 1;
				for (const failure of report.failed) reportExtensionFailure(workstream.id, failure.error);
				extensionRuntimeStore.ready = true;
				extensionRuntimeStore.error = null;
				settleReadiness(workstream.id);
				publishAutomationRunOptionsCommand();
				announceCreation(generation, request);
			} catch (error) {
				commitActiveWorkstream();
				if (generation !== extensionRuntimeStore.activationGeneration) return;
				extensionRuntimeStore.requestedWorkstreamFingerprint = null;
				failReadiness(workstream.id, error);
			}
		})();
	});

	return () => {
		cancelActivationRelease();
		readinessDeadline(request.currentWorkstreamId).cancel(workstream.id);
		if (generation === extensionRuntimeStore.activationGeneration) {
			extensionRuntimeStore.activationGeneration += 1;
		}
		if (extensionRuntimeStore.requestedWorkstreamFingerprint === fingerprint) {
			extensionRuntimeStore.requestedWorkstreamFingerprint = null;
		}
	};
}

function commitActiveWorkstream(): void {
	const active = extensionRuntimeStore.service?.workstream ?? null;
	extensionRuntimeStore.activeWorkstream = active ? { ...active } : null;
}

function announceCreation(generation: number, request: ExtensionActivationRequest): void {
	const context = request.creationContext;
	if (!context) return;
	const coordinator = extensionRuntimeStore.coordinator();
	void (async () => {
		try {
			await coordinator.announceWorkstreamCreated(request.workstream.id, context);
		} catch (error) {
			if (generation === extensionRuntimeStore.activationGeneration) {
				reportExtensionFailure(request.workstream.id, error);
			}
			return;
		}
		if (generation === extensionRuntimeStore.activationGeneration) {
			request.onCreationAnnounced(request.workstream.id);
		}
	})();
}

function isCurrent(
	generation: number,
	workstreamId: string,
	request: ExtensionActivationRequest,
): boolean {
	return (
		generation === extensionRuntimeStore.activationGeneration &&
		workstreamId === request.currentWorkstreamId()
	);
}

function readinessDeadline(
	currentWorkstreamId: () => string,
): ExtensionWorkstreamReadinessDeadline {
	extensionRuntimeStore.readinessDeadline ??= new ExtensionWorkstreamReadinessDeadline({
		onTimeout: (workstreamId) => {
			if (workstreamId !== currentWorkstreamId() || extensionRuntimeStore.ready) return;
			const seconds = Math.round(EXTENSION_WORKSTREAM_READINESS_DEADLINE_MS / 1_000);
			extensionRuntimeStore.error = `The extension host did not become ready within ${seconds} seconds. The workstream is still open; retry the inspector without reloading the app.`;
			dismissExtensionReadinessToastCommand(workstreamId);
			if (inspectorDrawer.isOpen(workstreamId)) return;
			extensionRuntimeStore.readinessToast = {
				workstreamId,
				id: toast.error(
					`Workstream inspector could not start · ${extensionRuntimeStore.error}`,
					aboutWorkstream(workstreamId),
				),
			};
		},
	});
	return extensionRuntimeStore.readinessDeadline;
}

function settleReadiness(workstreamId: string): void {
	extensionRuntimeStore.readinessDeadline?.settle(workstreamId);
	dismissExtensionReadinessToastCommand(workstreamId);
}

function failReadiness(workstreamId: string, error: unknown): void {
	settleReadiness(workstreamId);
	extensionRuntimeStore.ready = false;
	extensionRuntimeStore.error = extensionErrorMessage(
		error,
		'The extension host could not start for this workstream.',
	);
	if (inspectorDrawer.isOpen(workstreamId)) return;
	reportExtensionFailure(workstreamId, error);
}

function reportExtensionFailure(workstreamId: string, error: unknown): void {
	const causes = (error instanceof AggregateError ? error.errors : [])
		.map((cause) => (cause instanceof Error ? cause.message : String(cause)))
		.filter((message) => message.trim().length > 0);
	const fallback = error instanceof Error ? error.message : String(error);
	toast.error(
		`An extension could not start · ${causes.length > 0 ? causes.join('\n') : fallback}`,
		aboutWorkstream(workstreamId),
	);
}

function extensionErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === 'string' && error.trim()) return error;
	return fallback;
}

function recoveryModeEnabled(): boolean {
	try {
		return globalThis.localStorage?.getItem('malini.extensions.recovery-mode') === 'true';
	} catch {
		return false;
	}
}
