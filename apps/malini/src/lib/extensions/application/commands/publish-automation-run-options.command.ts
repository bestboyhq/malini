import {
	automationRulesStore,
	type AutomationRunOption,
} from '$shared/extensions/automation-rules.store.svelte';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function publishAutomationRunOptionsCommand(): void {
	const service = extensionRuntimeStore.service;
	automationRulesStore.publishFailures(service ? service.automations.failures : []);
	if (!service || !service.workstream) {
		automationRulesStore.publishRunOptions(null);
		return;
	}
	const contributions = service.host.contributions;
	automationRulesStore.publishRunOptions([
		...contributions.listWorkflows().map((workflow): AutomationRunOption => ({
			kind: 'workflow',
			id: workflow.id,
			label: workflow.label,
		})),
		...contributions.listCommands().map((command): AutomationRunOption => ({
			kind: 'command',
			id: command.id,
			label: command.title,
		})),
	]);
}
