<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import type { WorkstreamStanding } from '$lib/initiatives/domain/initiative';
	import { repositoryName } from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import StatusIcon from './StatusIcon.svelte';

	interface Props {
		workstreamId: string;
		standing: WorkstreamStanding;
	}

	let { workstreamId, standing }: Props = $props();

	const place = $derived(
		[
			standing.repositoryFullName ? repositoryName(standing.repositoryFullName) : null,
			standing.pullRequestNumber === null ? null : `#${standing.pullRequestNumber}`,
		]
			.filter(Boolean)
			.join(' '),
	);
</script>

{#snippet line()}
	<StatusIcon status={standing.dot} size={12} label={standing.label} />
	<span class="min-w-0 flex-1 truncate"><SensitiveText text={standing.name} /></span>
	{#if place}
		<span class="text-3xs text-fg-tertiary shrink-0 whitespace-nowrap">{place}</span>
	{/if}
{/snippet}

{#if standing.open}
	<Button
		bare
		href={workstreamHref(workstreamId)}
		class="text-fg-tertiary hover:bg-surface-root-hover hover:text-fg-default focus-visible:ring-border-default/50 -mx-1.5 flex min-h-[26px] items-center gap-2 rounded-md pr-9.5 pl-6 text-xs outline-none focus-visible:ring-2"
	>
		{@render line()}
	</Button>
{:else}
	<div class="text-fg-tertiary -mx-1.5 flex min-h-[26px] items-center gap-2 pr-9.5 pl-6 text-xs">
		{@render line()}
	</div>
{/if}
