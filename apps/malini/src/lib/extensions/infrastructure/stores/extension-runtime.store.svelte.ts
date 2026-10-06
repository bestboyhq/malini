import type { ExtensionPanelRegistration, ExtensionWorkstream } from '@malini/extension-api';
import type { ToastId } from '$hyper-ui/components/toast';

import { ExtensionWorkstreamReadinessDeadline } from '../runtime/extension-readiness-deadline';
import { ExtensionRuntimeLifetime } from '../runtime/extension-runtime-lifetime';
import type { ExtensionRuntimeCoordinator } from '../runtime/extension-runtime-coordinator';
import type { WorkstreamExtensions } from '../runtime/workstream-extensions';

type WorkstreamLifecycleAnnouncement = Readonly<{
	action: 'archived' | 'deleted';
	workstreamId: string;
}>;

class ExtensionRuntimeStore {
	service = $state.raw<WorkstreamExtensions | null>(null);
	ready = $state(false);
	error = $state<string | null>(null);
	settingsRevision = $state(0);
	workstreamRevision = $state(0);
	activationRetryRevision = $state(0);
	requestedPanelId = $state<string | null>(null);
	activationGeneration = $state(0);
	activeWorkstream = $state.raw<ExtensionWorkstream | null>(null);
	requestedWorkstreamFingerprint: string | null = null;
	requestedInBackground = false;
	readinessDeadline: ExtensionWorkstreamReadinessDeadline | null = null;
	readinessToast: { workstreamId: string; id: ToastId } | null = null;
	#lease = $state.raw<{
		coordinator: ExtensionRuntimeCoordinator;
		release(): Promise<void>;
	} | null>(null);
	#teardowns: Array<() => void> = [];
	#hosts = 0;
	#deferredLifecycle: WorkstreamLifecycleAnnouncement[] = [];

	get panels(): readonly ExtensionPanelRegistration[] {
		return this.#lease?.coordinator.inspectorPanels.panels ?? [];
	}

	documentTemplate(templateId: string): ExtensionPanelRegistration | null {
		return this.#lease?.coordinator.inspectorPanels.documentTemplate(templateId) ?? null;
	}

	coordinator(): ExtensionRuntimeCoordinator {
		const lease = this.#lease;
		if (!lease) throw new Error('The extension runtime is not mounted');
		return lease.coordinator;
	}

	isMounted(): boolean {
		return this.#lease !== null;
	}

	retainHost(): void {
		this.#hosts += 1;
	}

	releaseHost(): boolean {
		this.#hosts = Math.max(0, this.#hosts - 1);
		return this.#hosts === 0;
	}

	isHosted(): boolean {
		return this.#hosts > 0;
	}

	deferLifecycle(announcement: WorkstreamLifecycleAnnouncement): void {
		this.#deferredLifecycle.push(announcement);
	}

	takeDeferredLifecycle(): readonly WorkstreamLifecycleAnnouncement[] {
		return this.#deferredLifecycle.splice(0);
	}

	acquire(): ExtensionRuntimeCoordinator {
		this.#lease ??= lifetime.acquire();
		return this.#lease.coordinator;
	}

	registerTeardown(teardown: () => void): void {
		this.#teardowns.push(teardown);
	}

	runTeardowns(): void {
		const pending = this.#teardowns.reverse();
		this.#teardowns = [];
		for (const teardown of pending) teardown();
	}

	release(): Promise<void> {
		const lease = this.#lease;
		this.#lease = null;
		this.service = null;
		this.ready = false;
		this.error = null;
		this.requestedPanelId = null;
		this.requestedWorkstreamFingerprint = null;
		this.requestedInBackground = false;
		this.activationGeneration += 1;
		this.activeWorkstream = null;
		return lease?.release() ?? Promise.resolve();
	}
}

const lifetime = new ExtensionRuntimeLifetime();

export const extensionRuntimeStore = new ExtensionRuntimeStore();
