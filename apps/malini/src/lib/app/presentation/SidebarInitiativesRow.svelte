<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamStandingQuery } from '$lib/app/application/queries/workstream-standing.query.svelte';
	import { loadInitiativesCommand } from '$lib/initiatives/application/commands/load-initiatives.command';
	import { initiativesQuery } from '$lib/initiatives/application/queries/initiatives.query.svelte';
	import { INITIATIVES_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';

	interface Props {
		compact: boolean;
	}

	let { compact }: Props = $props();

	const countId = $props.id();
	const needsYou = $derived(initiativesQuery.needsYou(workstreamStandingQuery.of));
	const current = $derived(page.route.id === INITIATIVES_HREF);

	onMount(() => {
		loadInitiativesCommand();
	});
</script>

<Button
	bare
	href={INITIATIVES_HREF}
	ariaLabel="Initiatives"
	{...current ? { ariaCurrent: 'page' as const } : {}}
	{...needsYou > 0 ? { ariaDescribedby: countId } : {}}
	class={[
		'flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 outline-none',
		compact ? 'h-7 text-xs' : 'h-8 text-sm',
		current
			? 'bg-surface-root-selected text-fg-default'
			: 'text-fg-secondary hover:bg-surface-root-hover hover:text-fg-default focus-visible:bg-surface-root-hover focus-visible:text-fg-default',
	]}
	data-testid="sidebar-initiatives-row"
>
	<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
		<Icon name="circle-dot" size={15} />
	</span>
	<span class="min-w-0 flex-1 truncate text-left leading-relaxed">Initiatives</span>
	{#if needsYou > 0}
		<span id={countId} class="text-fg-quaternary shrink-0 text-xs tabular-nums">
			{needsYou}
			{needsYou === 1 ? 'needs' : 'need'} you
		</span>
	{/if}
</Button>
