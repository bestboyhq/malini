<script lang="ts">
	import { quartOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { asksYou, type LiveAutomation } from '$lib/automations/domain/live-automations';
	import AutomationQuestionLink from './AutomationQuestionLink.svelte';
	import AutomationQuestionRow from './AutomationQuestionRow.svelte';
	import AutomationRunRow from './AutomationRunRow.svelte';

	interface Props {
		entries: readonly LiveAutomation[];
		nowMs: number;
	}

	let { entries, nowMs }: Props = $props();
</script>

<ul aria-label="Automations in progress" class="flex flex-col gap-1">
	{#each entries as entry (entry.key)}
		<li transition:slide={{ duration: motionOff() ? 0 : 240, easing: quartOut }}>
			{#if asksYou(entry) && entry.run?.status !== 'needs-you'}
				<AutomationQuestionRow {entry} {nowMs} />
			{:else if asksYou(entry)}
				<AutomationQuestionLink {entry} />
			{:else if entry.run}
				<AutomationRunRow run={entry.run} {nowMs} />
			{/if}
		</li>
	{/each}
</ul>
