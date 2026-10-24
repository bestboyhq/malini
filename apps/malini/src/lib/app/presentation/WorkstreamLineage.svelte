<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ChatTileIcon, Icon } from '$hyper-ui/icons';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import {
		activeWorkstreamsQuery,
		repositoryContextQuery,
		workstreamByIdQuery,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { PROGRESS_DOT_CLASS } from './progress-dot-class';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const SIBLINGS_SHOWN = 4;

	const workstream = $derived(workstreamByIdQuery.data(workstreamId));
	const starterId = $derived(workstream?.scope === null ? workstream.startedBy : null);
	const starter = $derived(starterId === null ? null : workstreamByIdQuery.data(starterId));
	const siblings = $derived(
		starterId === null
			? []
			: activeWorkstreamsQuery.data.filter(
					(candidate) =>
						candidate.startedBy === starterId &&
						candidate.id !== workstreamId &&
						candidate.scope === null,
				),
	);
</script>

{#if starterId !== null}
	{@const starterName = workstreamNameQuery.data(starterId) ?? 'another chat'}
	<div
		class="border-surface-50-border text-fg-tertiary -mx-3 mt-2 mb-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border-[0.5px] px-3 py-2 text-xs"
		role="group"
		aria-label="Lineage"
		data-testid="workstream-lineage"
	>
		{#snippet starterLabel()}
			{#if starter?.scope}
				<ChatTileIcon size={14} />
			{:else}
				<Icon name="branch" size={13} />
			{/if}
			Started by
			<span class="text-fg-default font-medium">{starterName}</span>
		{/snippet}
		{#if starter}
			<Button
				bare
				href={workstreamHref(starter.id)}
				class="hover:text-fg-secondary inline-flex min-w-0 items-center gap-1.5"
				data-testid="workstream-lineage-starter"
			>
				{@render starterLabel()}
			</Button>
		{:else}
			<span class="inline-flex min-w-0 items-center gap-1.5">{@render starterLabel()}</span>
		{/if}
		{#if siblings.length > 0}
			<span class="bg-surface-150-border h-3.5 w-[0.5px] shrink-0" aria-hidden="true"></span>
			<span>{siblings.length === 1 ? 'Sibling' : 'Siblings'}</span>
			{#each siblings.slice(0, SIBLINGS_SHOWN) as sibling (sibling.id)}
				{@const repository = repositoryContextQuery.data(sibling.id)}
				{@const name = workstreamNameQuery.data(sibling.id) ?? ''}
				<Button
					bare
					href={workstreamHref(sibling.id)}
					ariaLabel={repository ? `${repository.repo.fullName}, ${name}` : name}
					class="hover:text-fg-secondary inline-flex min-w-0 items-center gap-1.5"
					data-testid="workstream-lineage-sibling"
				>
					<span
						class={[
							'h-1.5 w-1.5 shrink-0 rounded-full',
							PROGRESS_DOT_CLASS[leadProgressQuery.dot(sibling)],
						]}
						aria-hidden="true"
					></span>
					<span class="text-fg-default font-medium">{repository?.name ?? name}</span>
				</Button>
			{/each}
			{#if siblings.length > SIBLINGS_SHOWN}
				<span>+{siblings.length - SIBLINGS_SHOWN} more</span>
			{/if}
		{/if}
	</div>
{/if}
