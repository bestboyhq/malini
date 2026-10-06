<script lang="ts">
	import { onDestroy, onMount, type Snippet } from 'svelte';

	import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';
	import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
	import {
		bindExtensionNavigationHook,
		bindExtensionRepositoryHook,
	} from '$shared/repositories/repositories.api';
	import { onWorkstreamLinkIntent } from '$shared/router/workstream-link-intent';

	import { focusExtensionWorkstreamCommand } from '../application/commands/focus-extension-workstream.command';
	import { publishAutomationRunOptionsCommand } from '../application/commands/publish-automation-run-options.command';
	import { startExtensionRuntimeCommand } from '../application/commands/start-extension-runtime.command';
	import { stopExtensionRuntimeCommand } from '../application/commands/stop-extension-runtime.command';
	import { warmExtensionWorkstreamCommand } from '../application/commands/warm-extension-workstream.command';
	import { warmMostRecentWorkstreamCommand } from '../application/commands/warm-most-recent-workstream.command';
	import { extensionSettingsRevisionQuery } from '../application/queries/extension-settings-revision.query.svelte';
	import { knownExtensionWorkstreamsQuery } from '../application/queries/known-extension-workstreams.query.svelte';

	interface Props {
		workstreamId?: string;
		children?: Snippet;
	}

	let { workstreamId = '', children }: Props = $props();
	let observedWorkstreamId: string | null = null;
	const settingsRevision = $derived(extensionSettingsRevisionQuery.data);
	const knownWorkstreams = $derived(knownExtensionWorkstreamsQuery.data);
	const releases: Array<() => void> = [];

	onMount(() => {
		releases.push(bindExtensionRepositoryHook(), bindExtensionNavigationHook());
		startExtensionRuntimeCommand({ knownWorkstreams: knownExtensionWorkstreamsQuery.read });
		releases.push(
			scheduleAfterSettledNavigationPaint(onFirstPaint),
			onWorkstreamLinkIntent((intent) => onWorkstreamIntent(intent.workstreamId)),
		);
	});

	$effect(() => {
		const target = workstreamId;
		if (target === observedWorkstreamId) return;
		observedWorkstreamId = target;
		focusExtensionWorkstreamCommand(target);
	});

	$effect(() => {
		void automationRulesStore.definitions;
		void settingsRevision;
		publishAutomationRunOptionsCommand();
	});

	onDestroy(() => {
		stopExtensionRuntimeCommand();
		for (const release of releases.splice(0).reverse()) release();
	});

	function onFirstPaint(): void {
		void warmMostRecentWorkstreamCommand(() => workstreamId);
	}

	function onWorkstreamIntent(intentWorkstreamId: string): void {
		const target = knownWorkstreams.find(({ id }) => id === intentWorkstreamId);
		if (target) warmExtensionWorkstreamCommand(target);
	}
</script>

{#if children}{@render children()}{/if}
