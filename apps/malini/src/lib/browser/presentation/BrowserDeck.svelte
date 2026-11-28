<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	import { closeBrowserTabCommand } from '../application/commands/close-browser-tab.command';
	import { openBrowserTabCommand } from '../application/commands/open-browser-tab.command';
	import { switchBrowserProfileCommand } from '../application/commands/switch-browser-profile.command';
	import { browserStateQuery } from '../application/queries/browser-state.query.svelte';
	import { browserTabsQuery } from '../application/queries/browser-tabs.query.svelte';
	import { DECK_ADD_WIDTH, deckColumnWidth } from '../domain/browser-deck';
	import { browserTabKey, browserTabLabel } from '../domain/browser-tab';
	import type { OfferedVariants } from '../domain/variant-pages';
	import BrowserPanel from './BrowserPanel.svelte';
	import BrowserProfileMenu from './BrowserProfileMenu.svelte';

	interface Props {
		workstreamId: string;
		offered: OfferedVariants;
	}

	let { workstreamId, offered }: Props = $props();

	const tabs = $derived(browserTabsQuery.data(workstreamId));

	let width = $state(0);
	const columnWidth = $derived(deckColumnWidth(width, tabs.length));
	let scroller: HTMLElement | null = null;
	let settled = false;

	function followWidth(element: HTMLElement): () => void {
		scroller = element;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) width = entry.contentRect.width;
		});
		observer.observe(element);
		const frame = requestAnimationFrame(() => (settled = true));
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			scroller = null;
		};
	}

	function clip(): DOMRect | null {
		return scroller?.getBoundingClientRect() ?? null;
	}

	function revealAdded(column: HTMLElement): void {
		if (settled) column.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
	}
</script>

<div
	{@attach followWidth}
	class="flex h-full min-h-0 snap-x snap-mandatory scroll-px-2 gap-2 overflow-x-auto overflow-y-hidden px-2 pb-2"
>
	{#each tabs as { tabId, profile } (tabId)}
		{@const tab = { workstreamId, tabId }}
		{@const label = browserTabLabel(browserStateQuery.data(browserTabKey(tab)))}
		<section
			{@attach revealAdded}
			aria-label="{profile}: {label}"
			class="border-surface-50-border bg-surface-50 flex h-full shrink-0 snap-start flex-col rounded-xl border-[0.5px] p-1.5"
			style:width="{columnWidth}px"
		>
			<header class="flex min-w-0 shrink-0 items-center gap-1 pb-1.5 pl-1">
				<BrowserProfileMenu
					heading="Profile"
					ariaLabel="Profile {profile}"
					current={profile}
					triggerClass="text-fg-default hover:bg-surface-50-hover flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs font-medium"
					onpick={(picked) => switchBrowserProfileCommand(tab, picked)}
				>
					<Icon name="user" size={12} class="text-fg-tertiary shrink-0" />
					<span class="truncate">{profile}</span>
					<Icon name="chevron-down" size={12} class="text-fg-tertiary shrink-0" />
				</BrowserProfileMenu>
				<span class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">{label}</span>
				<Tooltip content="Close" placement="top" class="shrink-0">
					<IconButton
						ariaLabel="Close {label}"
						variant="ghost"
						size="sm"
						onclick={() => closeBrowserTabCommand(tab)}
					>
						<Icon name="close" size={12} />
					</IconButton>
				</Tooltip>
			</header>
			<BrowserPanel {workstreamId} {tabId} {offered} inDeck {clip} />
		</section>
	{/each}
	<div class="flex h-full shrink-0 snap-end" style:width="{DECK_ADD_WIDTH}px">
		<BrowserProfileMenu
			heading="New tab in profile"
			ariaLabel="Add column"
			side="left"
			align="center"
			triggerClass="border-border-default text-fg-tertiary hover:text-fg-default flex size-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-xs transition-[color,border-color]"
			onpick={(profile) => openBrowserTabCommand(workstreamId, profile)}
		>
			<Icon name="plus" size={14} />
			Add column
		</BrowserProfileMenu>
	</div>
</div>
