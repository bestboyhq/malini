import type { ExtensionWorkstream } from '@malini/extension-api';
import { REPOSITORY_STATE_CHANGED_EVENT } from '@malini-extension/repository';
import { createPlatformRoutineGateStore } from '$shared/extensions/automation-gate';
import { loadAutomationRules } from '$shared/extensions/automation-rules.store.svelte';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { workstreamSnapshotsHook } from '$shared/repositories/repositories.api';

import { attachRoutineGateDecisions } from '../../infrastructure/services/routine-gate-decisions.service';
import { onRoutinesChanged } from '../../infrastructure/services/routines-changed.service';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { announceWorkstreamLifecycleCommand } from './announce-workstream-lifecycle.command';

type ExtensionRuntimeStart = Readonly<{
	knownWorkstreams?: () => readonly ExtensionWorkstream[];
}>;

export function startExtensionRuntimeCommand(start: ExtensionRuntimeStart = {}): void {
	extensionRuntimeStore.retainHost();
	if (extensionRuntimeStore.service) return;
	const coordinator = extensionRuntimeStore.acquire();
	const service = coordinator.initialize({
		...(start.knownWorkstreams ? { knownWorkstreams: start.knownWorkstreams } : {}),
		workstreamSnapshots: workstreamSnapshotsHook(),
		routineGate: createPlatformRoutineGateStore(),
		routinesLoader: () => loadAutomationRules(),
	});
	extensionRuntimeStore.service = service;
	extensionRuntimeStore.ready = service.workstream !== null;

	const settings = service.host.contributions.onDidChange(() => {
		extensionRuntimeStore.settingsRevision += 1;
	});
	extensionRuntimeStore.registerTeardown(() => void settings.dispose());

	const repositoryState = service.host.contributions.onEvent(REPOSITORY_STATE_CHANGED_EVENT, () => {
		extensionRuntimeStore.workstreamRevision += 1;
	});
	extensionRuntimeStore.registerTeardown(() => void repositoryState.dispose());

	extensionRuntimeStore.registerTeardown(
		extensionCommands.connect({
			workstreamId: () => extensionRuntimeStore.service?.workstream?.id ?? null,
			execute: (commandId, ...args) =>
				service.host.contributions.executeCommand(commandId, ...args),
			emit: (channel, payload) => service.host.contributions.emit(channel, payload),
			onEvent: (channel, listener) => {
				const subscription = service.host.contributions.onEvent(channel, listener);
				return () => void subscription.dispose();
			},
		}),
	);

	extensionRuntimeStore.registerTeardown(attachRoutineGateDecisions(service.automations));
	extensionRuntimeStore.registerTeardown(
		onRoutinesChanged(() => {
			void coordinator.reloadRoutines();
		}),
	);
	for (const { action, workstreamId } of extensionRuntimeStore.takeDeferredLifecycle()) {
		announceWorkstreamLifecycleCommand(action, workstreamId);
	}
}
