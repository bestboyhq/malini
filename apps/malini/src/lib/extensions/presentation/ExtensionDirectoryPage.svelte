<script lang="ts">
	import { pushState } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount } from 'svelte';
	import { recordShallowHistoryCommit } from '$shared/router/history-ledger';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { bundledExtensionActivation } from '../domain/bundled-extension-activation';
	import { searchExtensionDirectory } from '../domain/extension-directory-search';
	import type { ExtensionDirectoryEntry } from '../domain/extension-directory-entry';
	import ExtensionDirectoryIcon from './ExtensionDirectoryIcon.svelte';
	import { bundledExtensionDirectoryEntries } from './extension-directory-catalog';
	import { extensionDirectoryHref } from './extension-directory-navigation';

	interface Props {
		workstreamId: string;
		agentSessionId?: string | null;
	}
	let { workstreamId, agentSessionId = null }: Props = $props();
	const entries: readonly ExtensionDirectoryEntry[] = bundledExtensionDirectoryEntries;
	let query = $state('');
	let focusFrame: number | null = null;
	let headingElement = $state<HTMLHeadingElement | null>(null);
	const visible = $derived(searchExtensionDirectory(entries, query));
	const location = $derived({ workstreamId, agentSessionId });

	function activationLabel(extensionId: string): string {
		const activation = bundledExtensionActivation(extensionId);
		if (!activation) return 'Installable';
		return activation === 'built-in' ? 'Built in' : 'Enable per repository';
	}

	onMount(() => {
		if (
			page.state.extensionDirectory?.workstreamId === workstreamId &&
			page.state.extensionDirectory.extensionId === null
		) {
			focusFrame = requestAnimationFrame(() => {
				focusFrame = null;
				headingElement?.focus({ preventScroll: true });
			});
		}
	});

	onDestroy(() => {
		if (focusFrame !== null) cancelAnimationFrame(focusFrame);
		focusFrame = null;
	});

	function openDetailShallow(event: MouseEvent, extensionId: string): void {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.shiftKey
		) {
			return;
		}
		event.preventDefault();
		pushDetailState(extensionId);
	}

	function pushDetailState(extensionId: string): void {
		pushState(extensionDirectoryHref(location, extensionId), {
			...page.state,
			extensionDirectory: { workstreamId, extensionId },
		});
		recordShallowHistoryCommit('push');
	}
</script>

<div
	class="extension-directory-page text-fg-default relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
	data-testid="extension-directory-page"
	data-navigation-workstream-id={workstreamId}
	data-navigation-agent-session-id={agentSessionId ?? undefined}
	data-navigation-ready="true"
>
	<header class="border-border-subtle border-b px-5 py-4">
		<div class="mx-auto flex max-w-6xl flex-col gap-3">
			<div class="extension-directory-heading flex flex-col gap-3">
				<div>
					<h1 bind:this={headingElement} class="text-xl font-medium" tabindex="-1">Extensions</h1>
					<p class="text-fg-tertiary mt-1 text-sm leading-5">
						Add focused tools to the repository you are working in.
					</p>
				</div>
				<div class="extension-directory-search relative w-full">
					<Icon
						name="search"
						size={16}
						class="text-fg-tertiary pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2"
					/>
					<TextInput
						bind:value={query}
						type="search"
						placeholder="Search extensions"
						inputClass="pl-9"
					/>
				</div>
			</div>
		</div>
	</header>

	<ScrollableDiv class="min-h-0 flex-1">
		<div class="extension-directory-grid mx-auto grid max-w-6xl gap-3 p-5">
			{#if visible.length === 0}
				<p class="text-fg-tertiary col-span-full py-16 text-center text-sm">
					No extensions match “{query}”.
				</p>
			{:else}
				{#each visible as entry (entry.id)}
					<a
						href={extensionDirectoryHref(location, entry.id)}
						data-navigation-path-id="expected-path:extension-directory.open-detail"
						data-navigation-shallow="true"
						data-testid="extension-directory-card"
						class="group border-surface-150-border bg-surface-150 hover:bg-surface-150-hover flex min-h-44 flex-col rounded-2xl border p-4 transition-colors"
						onclick={(event) => openDetailShallow(event, entry.id)}
					>
						<div class="flex items-start justify-between gap-3">
							<div
								class="bg-surface-100 text-fg-secondary grid size-10 place-items-center rounded-xl"
							>
								<ExtensionDirectoryIcon extensionId={entry.id} size={22} />
							</div>
							{#if entry.firstParty}
								<span class="bg-surface-100 text-3xs text-fg-secondary rounded-full px-2 py-1">
									{activationLabel(entry.id)}
								</span>
							{/if}
						</div>
						<h2 class="mt-4 text-base font-medium">{entry.name}</h2>
						<p class="text-fg-secondary mt-1 line-clamp-3 text-sm leading-5">{entry.summary}</p>
						<div class="text-fg-tertiary mt-auto pt-4 text-xs">By {entry.author.name}</div>
					</a>
				{/each}
			{/if}
		</div>
	</ScrollableDiv>
</div>

<style>
	.extension-directory-page {
		container-type: inline-size;
	}

	@container (min-width: 42rem) {
		.extension-directory-heading {
			flex-direction: row;
			align-items: flex-end;
			justify-content: space-between;
			gap: 1rem;
		}

		.extension-directory-search {
			width: 18rem;
		}

		.extension-directory-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			padding: 1.5rem;
		}
	}

	@container (min-width: 64rem) {
		.extension-directory-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
