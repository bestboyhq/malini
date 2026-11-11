<script lang="ts">
	import { BRIDGE_AGENT_CONTEXT_PATH } from '$contract/protocol-contract.generated';
	import {
		workstreamImageUrl,
		type ContextMedia,
		type ContextMediaCategory,
	} from '$contract/workstream-images';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Modal } from '$hyper-ui/components/modal';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { contextMediaListingQuery } from '$lib/chat/application/queries/context-media-listing.query.svelte';
	import {
		contextMediaAge,
		contextMediaTabs,
		type ContextMediaTab,
	} from '$lib/chat/domain/context-media';
	import MediaViewer, { type ViewerItem } from './MediaViewer.svelte';
	import WorkstreamMedia from './WorkstreamMedia.svelte';

	interface Props {
		workstreamId: string;
		onclose: () => void;
		onopendocument: (path: string) => void;
	}

	let { workstreamId, onclose, onopendocument }: Props = $props();

	const TAB_LABELS: Readonly<Record<ContextMediaTab['category'], string>> = {
		all: 'All',
		images: 'Images',
		videos: 'Videos',
		audio: 'Audio',
		pages: 'Pages',
		documents: 'Documents',
	};
	const VIEWABLE: ReadonlySet<ContextMediaCategory> = new Set(['images', 'videos', 'pages']);
	const now = Date.now();
	const uid = $props.id();

	let chosen = $state<ContextMediaTab['category']>('all');
	let viewing = $state.raw<Readonly<{ items: readonly ViewerItem[]; start: number }> | null>(null);

	const listing = $derived(contextMediaListingQuery.data(workstreamId));
	const media = $derived(listing?.status === 'ready' ? listing.media : []);
	const tabs = $derived(contextMediaTabs(media));
	const category = $derived(tabs.some((tab) => tab.category === chosen) ? chosen : 'all');
	const shown = $derived(
		category === 'all' ? media : media.filter((item) => item.category === category),
	);
	const viewable = $derived(shown.filter((item) => VIEWABLE.has(item.category)));

	function fileName(path: string): string {
		return path.slice(path.lastIndexOf('/') + 1);
	}

	function folderOf(path: string): string {
		return path.slice(`${BRIDGE_AGENT_CONTEXT_PATH}/`.length, Math.max(0, path.lastIndexOf('/')));
	}

	function source(item: ContextMedia): string {
		return item.category === 'audio' || /\.svg$/iu.test(item.path)
			? workstreamImageUrl(workstreamId, item.path, Date.parse(item.modifiedAt))
			: item.path;
	}

	function view(item: ContextMedia): void {
		viewing = {
			items: viewable.map((each) => ({
				workstreamId,
				src: source(each),
				label: fileName(each.path),
			})),
			start: viewable.indexOf(item),
		};
	}

	function moveAlongTabs(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (step === undefined) return;
		const index =
			(tabs.findIndex((tab) => tab.category === category) + step + tabs.length) % tabs.length;
		const next = tabs[index];
		if (!next) return;
		event.preventDefault();
		chosen = next.category;
		event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
	}
</script>

{#snippet caption(item: ContextMedia)}
	<span class="flex min-w-0 flex-col gap-px px-0.5 text-left">
		<span class="text-fg-default truncate text-xs">{fileName(item.path)}</span>
		<span class="text-fg-tertiary text-2xs truncate">
			{[folderOf(item.path), contextMediaAge(item.modifiedAt, now)].filter(Boolean).join(' · ')}
		</span>
	</span>
{/snippet}

{#snippet tile(item: ContextMedia, dismiss: () => void)}
	{@const thumb =
		'bg-surface-root outline-border-subtle relative block aspect-[4/3] w-full overflow-hidden rounded-lg outline-[0.5px] -outline-offset-[0.5px]'}
	{#if item.category === 'audio'}
		<div class="flex min-w-0 flex-col gap-1.5">
			<span class={[thumb, 'grid place-items-center pb-9']}>
				<Icon name="volume" size={22} class="text-fg-tertiary" />
				<audio
					controls
					preload="metadata"
					src={source(item)}
					aria-label={fileName(item.path)}
					class="absolute inset-x-1.5 bottom-1.5 h-8 w-[calc(100%-0.75rem)]"
				></audio>
			</span>
			{@render caption(item)}
		</div>
	{:else}
		<Button
			bare
			class="group/tile flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg outline-none"
			onclick={() => {
				if (VIEWABLE.has(item.category)) {
					view(item);
					return;
				}
				dismiss();
				onopendocument(item.path);
			}}
		>
			<span
				class={[
					thumb,
					'group-hover/tile:outline-border-default group-focus-visible/tile:ring-button-primary/40 transition-[outline-color] group-focus-visible/tile:ring-2',
				]}
			>
				{#if item.category === 'images' || item.category === 'videos'}
					<WorkstreamMedia
						{workstreamId}
						src={source(item)}
						label={fileName(item.path)}
						size="tile"
					/>
				{:else}
					<span class="grid size-full place-items-center">
						<FileTypeIcon path={item.path} size={32} />
					</span>
				{/if}
			</span>
			{@render caption(item)}
		</Button>
	{/if}
{/snippet}

<Modal
	open
	ariaLabel="Media"
	{onclose}
	class="rounded-[20px]"
	contentClass="flex h-[min(640px,calc(100vh-6rem))] w-[min(880px,calc(100vw-4rem))] flex-col"
>
	{#snippet children(dismiss)}
		<header class="flex items-center gap-3 pt-4 pr-4 pb-3 pl-5">
			<h2 class="text-fg-default text-[15px] font-semibold">Media</h2>
			<span class="text-fg-tertiary min-w-0 flex-1 truncate font-mono text-xs">.context</span>
			<IconButton variant="ghost" size="sm" ariaLabel="Close" onclick={dismiss}>
				<Icon name="close" size={16} />
			</IconButton>
		</header>
		{#if listing?.status === 'ready' && media.length > 0}
			<div
				class="flex flex-wrap items-center gap-1 px-4 pb-3"
				role="tablist"
				aria-label="Media types"
				tabindex="-1"
				onkeydown={moveAlongTabs}
			>
				{#each tabs as tab (tab.category)}
					{@const selected = tab.category === category}
					<Button
						bare
						id={`${uid}-${tab.category}`}
						role="tab"
						ariaSelected={selected}
						ariaControls={`${uid}-grid`}
						tabindex={selected ? 0 : -1}
						class={[
							'flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-[color]',
							selected
								? 'bg-surface-elevated-selected text-fg-default'
								: 'text-fg-secondary hover:bg-surface-50-hover',
						]}
						onclick={() => (chosen = tab.category)}
					>
						{TAB_LABELS[tab.category]}
						<span class="text-fg-tertiary tabular-nums">{tab.count}</span>
					</Button>
				{/each}
			</div>
			<ScrollableDiv class="min-h-0 flex-1" contentClass="px-5 pt-1 pb-5">
				<div
					id={`${uid}-grid`}
					role="tabpanel"
					aria-labelledby={`${uid}-${category}`}
					class="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-3 gap-y-4"
					data-testid="media-gallery-grid"
				>
					{#each shown as item (item.path)}
						{@render tile(item, dismiss)}
					{/each}
				</div>
			</ScrollableDiv>
		{:else}
			<div
				class="text-fg-tertiary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-5 pb-12 text-center text-xs"
				role={listing?.status === 'failed' ? 'alert' : 'status'}
			>
				{#if listing === null || listing.status === 'loading'}
					<BusyIcon size={16} />
					Looking in .context
				{:else if listing.status === 'failed'}
					<Icon name="alert" size={16} class="text-error-content" />
					<span class="text-fg-secondary max-w-[48ch]">{listing.error}</span>
				{:else}
					<Icon name="image" size={16} />
					No media yet. Agents save it here
				{/if}
			</div>
		{/if}
	{/snippet}
</Modal>

{#if viewing}
	<MediaViewer
		items={viewing.items}
		start={viewing.start}
		title="Media"
		onclose={() => (viewing = null)}
	/>
{/if}
