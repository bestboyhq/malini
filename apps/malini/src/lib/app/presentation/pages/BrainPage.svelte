<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$shared/router/state';
	import { Brain } from '$lib/brain/brain.api';
	import { loadBrainCommand } from '$lib/brain/application/commands/load-brain.command';
	import { watchBrainHook } from '$lib/brain/application/hooks/watch-brain.hook';
	import { runAutomationCommand } from '$lib/automations/application/commands/run-automation.command';
	import { automationActionStateQuery } from '$lib/automations/application/queries/automation-action-state.query.svelte';
	import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';

	const writeNotes = $derived(
		builtinAutomationDefinitionsQuery.data.find(
			(definition) => definition.builtin === 'write-brain-notes',
		) ?? null,
	);
	const writingNotes = $derived(
		writeNotes !== null && automationActionStateQuery.data(writeNotes.id).busy,
	);

	onMount(() => {
		loadBrainCommand();
		return watchBrainHook();
	});

	function onwritenotes(): void {
		if (writeNotes) runAutomationCommand({ definitionId: writeNotes.id });
	}
</script>

<svelte:head>
	<title>Malini · Brain</title>
</svelte:head>

<main class="flex h-full min-h-0 min-w-0 flex-col" data-testid="brain-page">
	<div class="native-page-drag-strip" data-native-drag-region></div>
	<Brain path={page.params.path ?? null} {writingNotes} {onwritenotes} />
</main>
