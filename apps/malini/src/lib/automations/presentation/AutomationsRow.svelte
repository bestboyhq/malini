<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { AUTOMATIONS_HREF } from '$shared/router/routes-hrefs';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import { liveAutomationsQuery } from '$lib/automations/application/queries/live-automations.query.svelte';
	import { liveAutomationCounts } from '$lib/automations/domain/live-automations';
	import { liveAutomationsSummary } from './live-automations-summary';

	interface Props {
		compact: boolean;
	}

	let { compact }: Props = $props();

	const counts = $derived(liveAutomationCounts(liveAutomationsQuery.data));
	const summary = $derived(liveAutomationsSummary(counts));

	onMount(() => {
		loadAutomationsCommand();
		return watchAutomationsHook();
	});
</script>

<Button
	bare
	href={AUTOMATIONS_HREF}
	class={[
		'text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 outline-none',
		compact ? 'h-7 text-xs' : 'h-8 text-sm',
	]}
	ariaLabel={summary ? `Automations, ${summary}` : 'Automations'}
	data-testid="sidebar-automations-row"
>
	<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="workflow" size={15} />
	</span>
	<span class="min-w-0 flex-1 truncate text-left leading-relaxed">Automations</span>
	{#if summary}
		<span
			class={[
				'flex shrink-0 items-center gap-1.5 text-xs',
				counts.needsYou > 0 ? 'text-brand-foreground' : 'text-fg-tertiary',
			]}
			aria-hidden="true"
		>
			{#if counts.needsYou > 0}
				<Icon name="dot" size={12} class="text-brand-icon" />
			{:else if counts.running > 0}
				<BusyIcon size={11} />
			{/if}
			{summary}
		</span>
	{/if}
</Button>
