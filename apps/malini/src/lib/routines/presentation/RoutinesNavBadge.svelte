<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { loadRoutinesCommand } from '$lib/routines/application/commands/load-routines.command';
	import { watchRoutinesHook } from '$lib/routines/application/hooks/watch-routines.hook';
	import { routineSuggestionCountQuery } from '$lib/routines/application/queries/routine-suggestion-count.query.svelte';

	const suggestionCount = $derived(routineSuggestionCountQuery.data);

	onMount(() => {
		loadRoutinesCommand();
		return watchRoutinesHook();
	});
</script>

<Tooltip
	content={suggestionCount > 0 ? `Routines · ${suggestionCount} suggested` : 'Routines'}
	placement="right"
>
	<IconButton
		variant="ghost"
		size="sm"
		href="/routines"
		ariaLabel={suggestionCount > 0
			? `Open routines, ${suggestionCount} suggested`
			: 'Open routines'}
		data-testid="sidebar-open-routines"
	>
		<span class="relative grid place-items-center">
			<Icon name="route" size={15} />
			{#if suggestionCount > 0}
				<span
					class="bg-brand text-brand-content ring-border-default absolute -right-1.5 -bottom-1 grid min-h-3 min-w-3 place-items-center rounded-full px-0.5 text-[8px] leading-3 font-medium tabular-nums ring-1"
					aria-hidden="true"
					data-testid="sidebar-routine-suggestion-count"
				>
					{suggestionCount}
				</span>
			{/if}
		</span>
	</IconButton>
</Tooltip>
