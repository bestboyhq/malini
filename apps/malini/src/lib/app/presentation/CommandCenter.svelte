<script lang="ts">
	import { closeCommandCenterCommand } from '$lib/app/application/commands/close-command-center.command';
	import { openCommandCenterCommand } from '$lib/app/application/commands/open-command-center.command';
	import { commandCenterQuery } from '$lib/app/application/queries/command-center.query.svelte';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import CommandCenterDialog from './CommandCenterDialog.svelte';

	const mode = $derived(commandCenterQuery.data);
	const setUp = $derived(onboardingQuery.data.finished === true);

	function onKeydown(event: KeyboardEvent): void {
		if (!setUp || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
		if (event.key.toLowerCase() !== 'k') return;
		event.preventDefault();
		if (mode === null) openCommandCenterCommand('commands');
		else closeCommandCenterCommand();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if mode !== null}
	<CommandCenterDialog {mode} />
{/if}
