<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { loadScratchpadCommand } from '$lib/scratchpad/application/commands/load-scratchpad.command';
	import { saveScratchpadCommand } from '$lib/scratchpad/application/commands/save-scratchpad.command';
	import { scratchpadQuery } from '$lib/scratchpad/application/queries/scratchpad.query.svelte';
	import type { ScratchpadStart } from '$lib/scratchpad/domain/scratchpad';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure } from '$shared/errors/failure-copy';
	import ScratchpadEditor from './ScratchpadEditor.svelte';

	interface Props {
		repositoryFullName: string;
		onstartworkstream: (start: ScratchpadStart) => void;
	}

	let { repositoryFullName, onstartworkstream }: Props = $props();

	const scratchpad = $derived(scratchpadQuery.data);
	const pad = $derived(scratchpad(repositoryFullName));
	const failure = $derived(
		pad.status === 'failed' ? describeFailure(pad.error, { subject: 'The scratchpad' }) : null,
	);

	onMount(() => loadScratchpadCommand(repositoryFullName));
</script>

{#if pad.status === 'ready'}
	<ScratchpadEditor
		content={pad.content}
		label={`Scratchpad for ${repositoryFullName}`}
		onchange={(content) => saveScratchpadCommand(repositoryFullName, content)}
		onstart={onstartworkstream}
	/>
{:else if failure}
	<StateBlock
		layout="inline"
		live="alert"
		tone={failure.tone}
		heading="Could not open the scratchpad"
		detail={failure.detail}
		remedy={failure.remedy}
		technical={failure.technical}
		testId="scratchpad-load-error"
	>
		{#snippet icon()}
			<Icon name="note" size={14} />
		{/snippet}
		{#snippet action()}
			<Button
				variant="secondary"
				size="sm"
				ariaLabel="Retry opening the scratchpad"
				onclick={() => loadScratchpadCommand(repositoryFullName)}
			>
				<Icon name="refresh" size={13} />
				Retry
			</Button>
		{/snippet}
	</StateBlock>
{/if}
