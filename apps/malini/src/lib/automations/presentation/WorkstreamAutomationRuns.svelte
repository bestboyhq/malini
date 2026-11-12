<script lang="ts">
	import { onMount } from 'svelte';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import type { LiveAutomation } from '$lib/automations/domain/live-automations';
	import AutomationRunList from './AutomationRunList.svelte';

	interface Props {
		entries: readonly LiveAutomation[];
		workstreamId: string;
		inGutter?: boolean;
	}

	let { entries, workstreamId, inGutter = false }: Props = $props();

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
	<div class={[!inGutter && 'max-h-60 overflow-y-auto p-1']}>
		<div class="text-fg-tertiary flex h-6 items-center px-2 text-xs" aria-hidden="true">
			Automations
		</div>
		<AutomationRunList {entries} {nowMs} shownIn={workstreamId} asksHere />
	</div>
</section>
