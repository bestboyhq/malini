<script lang="ts">
	import { onMount } from 'svelte';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import { workstreamAutomationRunsQuery } from '$lib/automations/application/queries/workstream-automation-runs.query.svelte';
	import AutomationRunCard from './AutomationRunCard.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const CLOCK_MS = 30_000;

	let nowMs = $state(Date.now());

	const runs = $derived(workstreamAutomationRunsQuery.data(workstreamId, nowMs));

	onMount(() => {
		loadAutomationsCommand();
		const releaseAutomations = watchAutomationsHook();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => {
			releaseAutomations();
			clearInterval(clock);
		};
	});
</script>

{#if runs.length > 0}
	<section class="mt-6" aria-label="Automations">
		<ul class="flex flex-col gap-2" aria-label="Automations run here">
			{#each runs as run (run.id)}
				<li><AutomationRunCard {run} {nowMs} /></li>
			{/each}
		</ul>
	</section>
{/if}
