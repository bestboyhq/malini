<script lang="ts">
	import { onMount } from 'svelte';
	import type { BrowserElementPrompt } from '$contract/browser';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { overlaySuppression } from '$hyper-ui/overlay';

	import { cancelElementPickCommand } from '../application/commands/cancel-element-pick.command';
	import { goBackBrowserCommand } from '../application/commands/go-back-browser.command';
	import { goForwardBrowserCommand } from '../application/commands/go-forward-browser.command';
	import { loadBrowserStateCommand } from '../application/commands/load-browser-state.command';
	import { navigateBrowserCommand } from '../application/commands/navigate-browser.command';
	import { openBrowserPageExternallyCommand } from '../application/commands/open-browser-page-externally.command';
	import { placeBrowserViewCommand } from '../application/commands/place-browser-view.command';
	import { reloadBrowserCommand } from '../application/commands/reload-browser.command';
	import { pickElementHook } from '../application/hooks/pick-element.hook';
	import { watchBrowserStateHook } from '../application/hooks/watch-browser-state.hook';
	import { browserPickingQuery } from '../application/queries/browser-picking.query.svelte';
	import { browserSnapshotQuery } from '../application/queries/browser-snapshot.query.svelte';
	import { browserStateQuery } from '../application/queries/browser-state.query.svelte';
	import { browserAddressLabel } from '../domain/browser-address';
	import { HIDDEN_BROWSER, browserPlacementFor } from '../domain/browser-placement';

	interface Props {
		workstreamId: string;
		onElementPrompt: (workstreamId: string, picked: BrowserElementPrompt) => void;
	}

	let { workstreamId, onElementPrompt }: Props = $props();

	const browser = $derived(browserStateQuery.data(workstreamId));
	const picking = $derived(browserPickingQuery.data(workstreamId));
	const snapshot = $derived(browserSnapshotQuery.data(workstreamId));
	const url = $derived(browser?.url ?? '');
	const shownUrl = $derived(browserAddressLabel(url));
	const hasPage = $derived(url !== '');

	let draft: string | null = $state(null);

	const pickElement = pickElementHook((id, picked) => onElementPrompt(id, picked));

	onMount(() => {
		loadBrowserStateCommand(workstreamId);
		return () => {
			if (picking) cancelElementPickCommand(workstreamId);
		};
	});

	$effect(() => watchBrowserStateHook());

	function followViewport(element: HTMLElement): () => void {
		let frame = requestAnimationFrame(place);
		function place(): void {
			const rect = element.getBoundingClientRect();
			const covered = overlaySuppression.isSuppressed({
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
			});
			placeBrowserViewCommand(workstreamId, browserPlacementFor(rect, hasPage, covered));
			frame = requestAnimationFrame(place);
		}
		return () => {
			cancelAnimationFrame(frame);
			placeBrowserViewCommand(workstreamId, HIDDEN_BROWSER);
		};
	}

	function onAddressInput(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement) draft = event.currentTarget.value;
	}

	function onAddressFocus(event: FocusEvent): void {
		const field = event.currentTarget;
		if (!(field instanceof HTMLInputElement)) return;
		draft ??= url;
		field.value = draft;
		field.select();
	}

	function onAddressKeydown(event: KeyboardEvent): void {
		const field = event.currentTarget;
		if (!(field instanceof HTMLInputElement)) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			navigateBrowserCommand(workstreamId, field.value);
			field.blur();
			return;
		}
		if (event.key !== 'Escape' || draft === null) return;
		event.preventDefault();
		draft = null;
		field.blur();
	}

	function onPickToggle(): void {
		if (picking) cancelElementPickCommand(workstreamId);
		else pickElement(workstreamId);
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col">
	<div class="flex shrink-0 items-center gap-1 px-4 pb-2">
		<Tooltip content="Back" placement="top" class="shrink-0">
			<IconButton
				ariaLabel="Back"
				variant="ghost"
				size="md"
				disabled={!browser?.canGoBack}
				onclick={() => goBackBrowserCommand(workstreamId)}
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
				onclick={() => goForwardBrowserCommand(workstreamId)}
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
				onclick={() => reloadBrowserCommand(workstreamId)}
			>
				<Icon name="refresh" size={14} />
			</IconButton>
		</Tooltip>
		<TextInput
			type="url"
			size="xs"
			value={draft ?? shownUrl}
			ariaLabel="Page address"
			placeholder="Type a URL"
			autocomplete="off"
			class="mx-1 min-w-0 flex-1"
			inputClass="text-xs"
			oninput={onAddressInput}
			onfocus={onAddressFocus}
			onkeydown={onAddressKeydown}
			onblur={() => (draft = null)}
		>
			{#snippet icon()}
				{#if browser?.loading}
					<LoadingCircle size={14} />
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
				disabled={!hasPage}
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
	</div>

	<div
		{@attach followViewport}
		class="border-surface-100-border bg-surface-100 relative mx-2 mb-2 min-h-0 flex-1 basis-[100vh] overflow-hidden rounded-2xl border-[0.5px]"
	>
		{#if browser && !hasPage}
			<div class="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
				<Icon name="globe" size={40} class="text-fg-tertiary" />
				<p class="text-fg-secondary text-sm">Open a page</p>
				<p class="text-fg-tertiary text-2xs max-w-64">
					Type a URL above, or ask the agent to open your dev server.
				</p>
			</div>
		{:else if snapshot}
			<img src={snapshot} alt="" class="absolute inset-0 size-full object-cover object-left-top" />
		{/if}
	</div>
</div>
