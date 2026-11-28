<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_BROWSER_PROFILE } from '$contract/browser';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { overlaySuppression } from '$hyper-ui/overlay';
	import { variantChoices } from '$shared/variants/variant-choices.store.svelte';

	import { cancelElementPickCommand } from '../application/commands/cancel-element-pick.command';
	import { goBackBrowserCommand } from '../application/commands/go-back-browser.command';
	import { goForwardBrowserCommand } from '../application/commands/go-forward-browser.command';
	import { loadBrowserProfilesCommand } from '../application/commands/load-browser-profiles.command';
	import { loadBrowserStateCommand } from '../application/commands/load-browser-state.command';
	import { navigateBrowserCommand } from '../application/commands/navigate-browser.command';
	import { openBrowserPageExternallyCommand } from '../application/commands/open-browser-page-externally.command';
	import { pictureBrowserPageCommand } from '../application/commands/picture-browser-page.command';
	import { placeBrowserViewCommand } from '../application/commands/place-browser-view.command';
	import { reloadBrowserCommand } from '../application/commands/reload-browser.command';
	import { setBrowserDeckCommand } from '../application/commands/set-browser-deck.command';
	import { settleBrowserAddressFocusCommand } from '../application/commands/settle-browser-address-focus.command';
	import { switchBrowserProfileCommand } from '../application/commands/switch-browser-profile.command';
	import { pickElementHook } from '../application/hooks/pick-element.hook';
	import { watchBrowserResizesHook } from '../application/hooks/watch-browser-resizes.hook';
	import { browserAddressFocusQuery } from '../application/queries/browser-address-focus.query.svelte';
	import { browserDeckQuery } from '../application/queries/browser-deck.query.svelte';
	import { browserPickingQuery } from '../application/queries/browser-picking.query.svelte';
	import { browserProfilesQuery } from '../application/queries/browser-profiles.query.svelte';
	import { browserSnapshotQuery } from '../application/queries/browser-snapshot.query.svelte';
	import { browserStateQuery } from '../application/queries/browser-state.query.svelte';
	import { browserTabsQuery } from '../application/queries/browser-tabs.query.svelte';
	import { browserAddressLabel } from '../domain/browser-address';
	import { browserTabKey } from '../domain/browser-tab';
	import {
		HIDDEN_BROWSER,
		browserPlacementFor,
		placedWidth,
		type BrowserCover,
	} from '../domain/browser-placement';
	import {
		isWorktreePage,
		steppedVariant,
		variantSwitcher,
		type OfferedVariant,
		type OfferedVariants,
		type VariantPage,
	} from '../domain/variant-pages';
	import BrowserProfileMenu from './BrowserProfileMenu.svelte';

	interface Props {
		workstreamId: string;
		tabId: string;
		offered: OfferedVariants;
		inDeck?: boolean;
		clip?: (() => DOMRect | null) | undefined;
	}

	let { workstreamId, tabId, offered, inDeck = false, clip }: Props = $props();

	const NO_VARIANTS: readonly (readonly OfferedVariant[])[] = [];

	const tab = $derived({ workstreamId, tabId });
	const tabKey = $derived(browserTabKey(tab));
	const browser = $derived(browserStateQuery.data(tabKey));
	const picking = $derived(browserPickingQuery.data(tabKey));
	const snapshot = $derived(browserSnapshotQuery.data(tabKey));
	const wantsAddressFocus = $derived(browserAddressFocusQuery.data(tabKey));
	const tabs = $derived(browserTabsQuery.data(workstreamId));
	const profiles = $derived(browserProfilesQuery.data);
	const deck = $derived(browserDeckQuery.data);
	const profile = $derived(
		tabs.find((entry) => entry.tabId === tabId)?.profile ?? DEFAULT_BROWSER_PROFILE,
	);
	const ownProfile = $derived(profile !== DEFAULT_BROWSER_PROFILE);
	const showsProfile = $derived(!inDeck && (ownProfile || profiles.length > 1));
	const url = $derived(browser?.url ?? '');
	const shownUrl = $derived(browserAddressLabel(url));
	const hasPage = $derived(url !== '');
	const failure = $derived(browser?.failure ?? null);
	const settledUrl = $derived(browser && !browser.loading && failure === null ? url : '');
	const variants = $derived(isWorktreePage(url) ? offered.data(workstreamId) : NO_VARIANTS);
	const switcher = $derived(variantSwitcher(url, workstreamId, variants));
	const shownVariant = $derived(
		switcher && failure === null ? (switcher.pages[switcher.current]?.url ?? null) : null,
	);

	let draft: string | null = $state(null);
	let viewport: HTMLElement | null = null;

	const pickElement = pickElementHook();

	$effect(() => watchBrowserResizesHook(tab, shownWidth, placeShown));

	$effect(() => {
		if (settledUrl) pictureBrowserPageCommand(tab);
	});

	$effect(() => {
		if (shownVariant) variantChoices.show(shownVariant);
	});

	onMount(() => {
		loadBrowserStateCommand(tab);
		loadBrowserProfilesCommand();
		return () => {
			if (picking) cancelElementPickCommand(tab);
		};
	});

	function placeViewport(element: HTMLElement): void {
		const rect = element.getBoundingClientRect();
		placeBrowserViewCommand(
			tab,
			browserPlacementFor(rect, hasPage && failure === null, coverOf(rect)),
		);
	}

	function coverOf(rect: DOMRect): BrowserCover {
		if (overlaySuppression.blockingDepth > 0 || clipped(rect)) return 'covered';
		const hole = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
		return overlaySuppression.isSuppressed(hole) ? 'overlapped' : 'none';
	}

	function clipped(rect: DOMRect): boolean {
		const bounds = clip?.();
		if (!bounds) return false;
		return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
	}

	function followViewport(element: HTMLElement): () => void {
		viewport = element;
		let frame = requestAnimationFrame(follow);
		function follow(): void {
			placeViewport(element);
			frame = requestAnimationFrame(follow);
		}
		return () => {
			viewport = null;
			cancelAnimationFrame(frame);
			placeBrowserViewCommand(tab, HIDDEN_BROWSER);
		};
	}

	function shownWidth(): number | null {
		return viewport && placedWidth(viewport.getBoundingClientRect());
	}

	function placeShown(): void {
		if (viewport) placeViewport(viewport);
	}

	function focusNewTabAddress(field: HTMLInputElement): void {
		if (!wantsAddressFocus) return;
		field.focus();
		settleBrowserAddressFocusCommand(tab);
	}

	function onAddressInput(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement) draft = event.currentTarget.value;
	}

	function onAddressFocus(event: FocusEvent): void {
		const field = event.currentTarget;
		if (!(field instanceof HTMLInputElement)) return;
		draft ??= url;
		field.select();
	}

	function onAddressMousedown(event: MouseEvent): void {
		const field = event.currentTarget;
		if (event.detail === 2 && field instanceof HTMLInputElement) letDoubleClickPickWord(field);
	}

	function letDoubleClickPickWord(field: HTMLInputElement): void {
		const { scrollLeft, selectionStart } = field;
		field.setSelectionRange(selectionStart, selectionStart);
		field.scrollLeft = scrollLeft;
	}

	function onAddressKeydown(event: KeyboardEvent): void {
		const field = event.currentTarget;
		if (!(field instanceof HTMLInputElement)) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			navigateBrowserCommand(tab, field.value);
			field.blur();
			return;
		}
		if (event.key !== 'Escape' || draft === null) return;
		event.preventDefault();
		draft = null;
		field.blur();
	}

	function onPickToggle(): void {
		if (picking) cancelElementPickCommand(tab);
		else pickElement(tab);
	}

	function variantLabel(page: VariantPage): string {
		return `Variant ${[page.id, page.name].filter(Boolean).join(' · ')}`;
	}

	function onStepVariant(step: number): void {
		const next = switcher && steppedVariant(switcher, step);
		if (next) navigateBrowserCommand(tab, next.url);
	}

	function onVariantKeydown(event: KeyboardEvent): void {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (step === undefined) return;
		event.preventDefault();
		onStepVariant(step);
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col">
	<div class={['flex shrink-0 items-center gap-1', inDeck ? 'px-0.5 pb-1.5' : 'px-4 pt-0.5 pb-2']}>
		<Tooltip content="Back" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Back"
				variant="ghost"
				size="md"
				disabled={!browser?.canGoBack}
				onclick={() => goBackBrowserCommand(tab)}
			>
				<Icon name="chevron-left" size={14} />
			</IconButton>
		</Tooltip>
		<Tooltip content="Forward" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Forward"
				variant="ghost"
				size="md"
				disabled={!browser?.canGoForward}
				onclick={() => goForwardBrowserCommand(tab)}
			>
				<Icon name="chevron-right" size={14} />
			</IconButton>
		</Tooltip>
		<Tooltip content="Reload" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Reload"
				variant="ghost"
				size="md"
				disabled={!hasPage}
				onclick={() => reloadBrowserCommand(tab)}
			>
				<Icon name="refresh" size={14} />
			</IconButton>
		</Tooltip>
		{#if showsProfile}
			<BrowserProfileMenu
				heading="Profile"
				ariaLabel="Profile {profile}"
				current={profile}
				triggerClass="bg-chip border-chip-border hover:bg-chip-hover text-fg-secondary ml-1 flex h-6 max-w-32 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md border-[0.5px] px-1.5 text-xs"
				onpick={(picked) => switchBrowserProfileCommand(tab, picked)}
			>
				<Icon name="user" size={12} class="shrink-0" />
				<span class="truncate">{profile}</span>
			</BrowserProfileMenu>
		{/if}
		<TextInput
			type="url"
			size="xs"
			value={draft ?? url}
			ariaLabel="Page address"
			placeholder="Type a URL"
			autocomplete="off"
			class="mx-1 min-w-0 flex-1"
			inputClass="text-xs"
			oninput={onAddressInput}
			onmousedown={onAddressMousedown}
			onfocus={onAddressFocus}
			onkeydown={onAddressKeydown}
			onblur={() => (draft = null)}
			{@attach focusNewTabAddress}
		>
			{#snippet icon()}
				{#if browser?.loading}
					<BusyIcon size={14} />
				{:else}
					<Icon name="globe" size={14} />
				{/if}
			{/snippet}
		</TextInput>
		<Tooltip content="Pick an element" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Pick an element"
				variant={picking ? 'primary-soft' : 'ghost'}
				size="md"
				ariaPressed={picking}
				disabled={!hasPage || failure !== null}
				onclick={onPickToggle}
			>
				<Icon name="pick-element" size={14} />
			</IconButton>
		</Tooltip>
		<Tooltip content="Open in your browser" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Open in your browser"
				variant="ghost"
				size="md"
				disabled={!hasPage}
				onclick={() => openBrowserPageExternallyCommand(url)}
			>
				<Icon name="external-link" size={14} />
			</IconButton>
		</Tooltip>
		<Tooltip content="Side by side" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Side by side"
				variant={deck ? 'primary-soft' : 'ghost'}
				size="md"
				ariaPressed={deck}
				onclick={() => setBrowserDeckCommand(workstreamId, !deck, tabId)}
			>
				<Icon name="columns" size={14} />
			</IconButton>
		</Tooltip>
	</div>

	<div
		{@attach followViewport}
		class={[
			'border-surface-100-border bg-surface-100 relative min-h-0 flex-1 basis-[100vh] overflow-hidden rounded-lg border-[0.5px]',
			!inDeck && 'mx-2 mb-2',
		]}
	>
		{#if browser && !hasPage}
			<div class="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
				<Icon name="globe" size={40} class="text-fg-tertiary" />
				<p class="text-fg-secondary text-sm">Open a page</p>
				<p class="text-fg-tertiary text-2xs max-w-64">
					{ownProfile
						? 'Type a URL above. This profile has its own cookies, so sign in once and it stays signed in.'
						: 'Type a URL above, or ask the agent to open your dev server.'}
				</p>
			</div>
		{:else if failure}
			<div
				role="status"
				class="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center"
			>
				<Icon name="warning" size={40} class="text-fg-tertiary" />
				<p class="text-fg-secondary text-sm">Could not open {shownUrl}</p>
				<p class="text-fg-tertiary text-2xs max-w-64">{failure}</p>
			</div>
		{:else if snapshot}
			<img src={snapshot} alt="" class="absolute inset-0 size-full object-cover object-left-top" />
		{/if}
	</div>

	{#if switcher && failure === null}
		<nav
			aria-label="Variants"
			class="mx-2 mb-2 flex min-w-0 shrink-0 items-center justify-center gap-1"
		>
			<Tooltip content="Previous variant" placement="top" class="shrink-0">
				<IconButton
					ariaLabel="Previous variant"
					variant="ghost"
					size="sm"
					onclick={() => onStepVariant(-1)}
					onkeydown={onVariantKeydown}
				>
					<Icon name="chevron-left" size={14} />
				</IconButton>
			</Tooltip>
			{#each switcher.pages as page, index (page.id)}
				{@const current = index === switcher.current}
				<Button
					bare
					ariaLabel={variantLabel(page)}
					ariaCurrent={current ? 'page' : 'false'}
					class={[
						'flex h-[26px] max-w-48 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-[color]',
						current
							? 'bg-surface-elevated text-fg-agent-message-strong outline-surface-elevated-border outline-[0.5px] -outline-offset-[0.5px]'
							: 'text-fg-secondary hover:bg-surface-50-hover',
					]}
					onclick={() => navigateBrowserCommand(tab, page.url)}
					onkeydown={onVariantKeydown}
				>
					<span class="text-fg-default shrink-0 font-medium">{page.id}</span>
					<span class="truncate">{page.name}</span>
				</Button>
			{/each}
			<Tooltip content="Next variant" placement="top" class="shrink-0">
				<IconButton
					ariaLabel="Next variant"
					variant="ghost"
					size="sm"
					onclick={() => onStepVariant(1)}
					onkeydown={onVariantKeydown}
				>
					<Icon name="chevron-right" size={14} />
				</IconButton>
			</Tooltip>
		</nav>
	{/if}
</div>
