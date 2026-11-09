<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import {
		onboardingPreviewRepository,
		onboardingPreviewStatus,
		onboardingSidebarPreview,
	} from '$lib/app/domain/onboarding-sidebar-preview';
	import type { SidebarArrangement } from '$lib/app/domain/sidebar-arrangement';
	import { branchWorkstreamIds, type SidebarBlock } from '$lib/app/domain/sidebar-tree';
	import type {
		ConnectedRepositoryContext,
		Workstream,
	} from '$shared/repositories/repositories.api';
	import { SECTION_ICONS } from '../sidebar-arrangement-icons';

	let { arrangement, compact }: { arrangement: SidebarArrangement; compact: boolean } = $props();

	const tree = $derived(onboardingSidebarPreview(arrangement));
	const rowSize = $derived(compact ? 'h-7 text-xs' : 'h-8 text-sm');
	const headerSize = $derived(compact ? 'text-2xs h-6' : 'h-7 text-xs');
	const LEVEL_PADDING = ['pl-2', 'pl-6', 'pl-9'] as const;
</script>

<div
	class="bg-surface-root border-border-default relative h-80 overflow-hidden rounded-2xl border-[0.5px] px-2 pt-2"
	data-testid="onboarding-sidebar-preview"
	aria-hidden="true"
	inert
>
	<ul class={['flex w-full flex-col', compact ? 'gap-1' : 'gap-3']}>
		{#each tree.blocks as block (block.id)}
			{@render blockRows(block)}
		{/each}
		{#each tree.sections as section (section.key)}
			{@const icon = SECTION_ICONS[section.key]}
			<li>
				<div
					class={['text-fg-tertiary flex items-center gap-2 pl-2 font-medium', headerSize]}
					data-testid="onboarding-sidebar-preview-section"
				>
					{#if icon}
						<span class="grid h-5 w-5 shrink-0 place-items-center">
							<Icon name={icon.name} size={14} class={icon.tone} />
						</span>
					{/if}
					<span class="min-w-0 truncate">{section.label}</span>
					<span class="text-3xs text-fg-quaternary shrink-0 font-mono tabular-nums">
						{branchWorkstreamIds(section).length}
					</span>
				</div>
				<ul class={['flex w-full flex-col', compact ? 'gap-0.5' : 'gap-1.5']}>
					{#each section.chats as workstream (workstream.id)}
						{@render workstreamRow(workstream, 0, onboardingPreviewRepository(workstream))}
					{/each}
					{#each section.blocks as block (block.id)}
						{@render blockRows(block)}
					{/each}
				</ul>
			</li>
		{/each}
		{#if tree.hidden > 0}
			<li
				class={['text-fg-tertiary flex items-center gap-2 pr-2 pl-2', rowSize]}
				data-testid="onboarding-sidebar-preview-hidden"
			>
				<span class="min-w-0 flex-1 truncate">{tree.hidden} hidden</span>
				<span class="text-fg-secondary shrink-0">Show all</span>
			</li>
		{/if}
	</ul>
	<div
		class="from-surface-root pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t to-transparent"
	></div>
</div>

{#snippet blockRows(block: SidebarBlock)}
	{#if block.kind === 'owner'}
		<li>
			<div class={['text-fg-secondary flex items-center gap-2 pl-2 font-medium', rowSize]}>
				<span
					class="bg-surface-50-selected text-fg-secondary text-3xs grid h-5 w-5 shrink-0 place-items-center rounded-full uppercase"
				>
					{block.owner.slice(0, 1)}
				</span>
				<span class="min-w-0 flex-1 truncate">{block.owner}</span>
			</div>
			<ul class="flex w-full flex-col gap-0.5">
				{#each block.repositories as repository (repository.repo.id)}
					{@render repositoryRows(repository, 1)}
				{/each}
			</ul>
		</li>
	{:else}
		{@render repositoryRows(block.repository, 0)}
	{/if}
{/snippet}

{#snippet repositoryRows(repository: ConnectedRepositoryContext, level: number)}
	<li>
		<div class={['text-fg-secondary flex items-center gap-2 pr-2', LEVEL_PADDING[level], rowSize]}>
			<span class="min-w-0 flex-1 truncate font-medium">{repository.name}</span>
		</div>
		<ul class="flex w-full flex-col">
			{#each repository.workstreams as workstream (workstream.id)}
				{@render workstreamRow(workstream, level + 1, null)}
			{/each}
		</ul>
	</li>
{/snippet}

{#snippet workstreamRow(workstream: Workstream, level: number, repositoryName: string | null)}
	{@const status = onboardingPreviewStatus(workstream)}
	<li class={['text-fg-secondary flex items-center gap-2 pr-2', LEVEL_PADDING[level], rowSize]}>
		<span class="grid h-5 w-5 shrink-0 place-items-center">
			<Icon
				name={status === 'in-review' ? 'pr-open' : 'branch'}
				size={14}
				class={status === 'needs-you' ? 'text-brand-icon' : 'text-fg-tertiary'}
			/>
		</span>
		<span class="min-w-0 flex-1 truncate leading-relaxed">{workstream.name}</span>
		{#if repositoryName}
			<span class="text-2xs text-fg-quaternary max-w-24 shrink-0 truncate">{repositoryName}</span>
		{/if}
	</li>
{/snippet}
