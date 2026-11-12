<script lang="ts">
	import { onMount } from 'svelte';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import type { LiveAutomation } from '$lib/automations/domain/live-automations';
	import AutomationRunList from './AutomationRunList.svelte';

	interface Props {
		entries: readonly LiveAutomation[];
		workstreamId: string;
	}

	let { entries, workstreamId }: Props = $props();

	let nowMs = $state(Date.now());

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});
</script>

<section
	{@attach avoidedByToasts}
	aria-label={`Automations (${entries.length})`}
	data-testid="workstream-automation-runs"
>
	<div class="max-h-60 overflow-y-auto p-1">
		<AutomationRunList {entries} {nowMs} shownIn={workstreamId} asksHere />
	</div>
</section>
