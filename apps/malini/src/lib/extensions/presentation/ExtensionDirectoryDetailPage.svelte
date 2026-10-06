<script lang="ts" module>
	type ExtensionIntent = Readonly<{
		eyebrow: string;
		title: string;
		description: string;
		outcomes: readonly string[];
		nextStep: string;
		action: string;
	}>;

	function extensionIntent(entry: ExtensionDirectoryEntry | null): ExtensionIntent {
		return {
			eyebrow: 'Extension',
			title: `Use ${entry?.name ?? 'this extension'}`,
			description: entry?.summary ?? 'Add a focused capability to this repository.',
			outcomes: ['Keep its state scoped to the active repository'],
			nextStep: `Open ${entry?.name ?? 'the extension'} beside your work.`,
			action: `Open ${entry?.name ?? 'extension'}`,
		};
	}
</script>

<script lang="ts">
	import type { ExtensionWorkstream } from '@malini/extension-api';
	import { pushState } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount } from 'svelte';
	import { enableExtensionForRepositoryCommand } from '../application/commands/enable-extension-for-repository.command';
	import { loadExtensionRepositoryEnablementCommand } from '../application/commands/load-extension-repository-enablement.command';
	import { openInspectorPanelCommand } from '../application/commands/open-inspector-panel.command';
	import { retryExtensionStartCommand } from '../application/commands/retry-extension-start.command';
	import { registerExtensionSettingsHook } from '../application/hooks/register-extension-settings.hook';
	import { extensionRepositoryEnablementQuery } from '../application/queries/extension-repository-enablement.query.svelte';
	import { extensionSettingsAccessQuery } from '../application/queries/extension-settings-access.query.svelte';
	import { bundledExtensionActivation } from '../domain/bundled-extension-activation';
	import { recordShallowHistoryCommit } from '$shared/router/history-ledger';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import {
		bundledExtensionDirectoryEntries,
		bundledExtensionManifests,
	} from './extension-directory-catalog';
	import DirectoryReadme from './DirectoryReadme.svelte';
	import ExtensionDirectoryIcon from './ExtensionDirectoryIcon.svelte';
	import ExtensionSettingsForm from './ExtensionSettingsForm.svelte';
	import type { ExtensionDirectoryEntry } from '../domain/extension-directory-entry';
	import {
		extensionDirectoryHref,
		extensionInspectorHref,
		type ExtensionDirectoryLocation,
	} from './extension-directory-navigation';

	interface Props {
		workstreamId: string;
		extensionId: string;
		agentSessionId?: string | null;
		extensionWorkstream?: ExtensionWorkstream | null;
		repositoryLabel?: string | null;
	}

	let {
		workstreamId,
		extensionId,
		agentSessionId = null,
		extensionWorkstream = null,
		repositoryLabel = null,
	}: Props = $props();
	const entry = $derived<ExtensionDirectoryEntry | null>(
		bundledExtensionDirectoryEntries.find(({ id }) => id === extensionId) ?? null,
	);
	const settingsAccess = $derived(extensionSettingsAccessQuery.data(extensionId));
	const enablement = $derived(extensionRepositoryEnablementQuery.data(workstreamId, extensionId));
	const changing = $derived(enablement.changing);
	const actionError = $derived(enablement.actionError);
	const repositoryEnabled = $derived(enablement.enabled);
	const repositoryStateLoading = $derived(enablement.loading);
	const repositoryStateError = $derived(enablement.error);
	let focusFrame: number | null = null;
	let detailHeadingElement = $state<HTMLHeadingElement | null>(null);
	let releaseSettings: (() => void) | null = null;
	let observedRepositoryTargetKey: string | null = null;

	const manifest = $derived(bundledExtensionManifests.get(extensionId) ?? null);
	const bundledActivation = $derived(bundledExtensionActivation(extensionId));
	const needsRepositoryEnablement = $derived(
		entry?.firstParty && bundledActivation === 'workstream',
	);
	const enabled = $derived(!needsRepositoryEnablement || repositoryEnabled);
	const primaryPanelId = $derived(manifest?.contributes?.panels?.[0]?.id ?? null);
	const intent = $derived(extensionIntent(entry));
	const location = $derived<ExtensionDirectoryLocation>({
		workstreamId,
		agentSessionId,
	});
	const panelNavigationTarget = $derived(
		primaryPanelId ? extensionInspectorHref(location) : undefined,
	);

	onMount(() => {
		if (
			page.state.extensionDirectory?.workstreamId === workstreamId &&
			page.state.extensionDirectory.extensionId === extensionId
		) {
			focusFrame = requestAnimationFrame(() => {
				focusFrame = null;
				detailHeadingElement?.focus({ preventScroll: true });
			});
		}
		if (manifest) releaseSettings = registerExtensionSettingsHook(manifest);
	});

	$effect(() => {
		const targetWorkstreamId = workstreamId;
		const targetExtensionId = extensionId;
		const targetKey = `${targetWorkstreamId}:${targetExtensionId}`;
		if (targetKey === observedRepositoryTargetKey) return;
		observedRepositoryTargetKey = targetKey;
		loadExtensionRepositoryEnablementCommand(targetWorkstreamId, targetExtensionId);
	});

	onDestroy(() => {
		if (focusFrame !== null) cancelAnimationFrame(focusFrame);
		focusFrame = null;
		releaseSettings?.();
		releaseSettings = null;
	});

	function enableForRepository(): void {
		enableExtensionForRepositoryCommand({
			workstreamId,
			workstream: extensionWorkstream,
			extensionId,
			panelId: primaryPanelId,
		});
	}

	function retryStart(): void {
		retryExtensionStartCommand({
			workstreamId,
			workstream: extensionWorkstream,
			extensionId,
			panelId: primaryPanelId,
		});
	}

	function openPanel(): void {
		if (primaryPanelId) openInspectorPanelCommand(workstreamId, primaryPanelId);
	}

	function openDirectoryShallow(event: MouseEvent): void {
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
		pushDirectoryState();
	}

	function pushDirectoryState(): void {
		pushState(extensionDirectoryHref(location), {
			...page.state,
			extensionDirectory: { workstreamId, extensionId: null },
		});
		recordShallowHistoryCommit('push');
	}
</script>

<div
	class="extension-directory-detail text-fg-default relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
	data-testid="extension-directory-detail-page"
	data-navigation-workstream-id={workstreamId}
	data-navigation-agent-session-id={agentSessionId ?? undefined}
	data-navigation-extension-id={extensionId}
	data-navigation-ready={!needsRepositoryEnablement ||
	(!repositoryStateLoading && !repositoryStateError)
		? 'true'
		: undefined}
	data-navigation-pending={needsRepositoryEnablement && repositoryStateLoading ? 'true' : undefined}
	data-navigation-error={needsRepositoryEnablement && repositoryStateError ? 'true' : undefined}
	data-navigation-error-message={(needsRepositoryEnablement ? repositoryStateError : null) ??
		undefined}
>
	<header class="border-border-subtle border-b px-4 py-2.5">
		<div class="mx-auto max-w-4xl" role="presentation">
			<Button
				href={extensionDirectoryHref(location)}
				variant="ghost"
				size="sm"
				data-navigation-path-id="expected-path:extension-detail.back"
				data-navigation-shallow="true"
				onclick={openDirectoryShallow}
			>
				<Icon name="chevron-left" size={14} /> Extensions
			</Button>
		</div>
	</header>

	<ScrollableDiv class="min-h-0 flex-1">
		<main class="mx-auto grid max-w-4xl gap-5 p-5">
			{#if !entry}
				<p class="text-fg-tertiary py-16 text-center text-sm">This extension is not available.</p>
			{:else}
				<section class="border-surface-150-border bg-surface-150 rounded-2xl border p-5">
					<div class="flex flex-wrap items-start justify-between gap-5">
						<div class="flex min-w-0 items-start gap-4">
							<div
								class="bg-surface-100 text-fg-secondary grid size-14 shrink-0 place-items-center rounded-2xl"
							>
								<ExtensionDirectoryIcon extensionId={entry.id} size={28} />
							</div>
							<div class="min-w-0">
								<p class="text-3xs text-fg-tertiary font-medium tracking-[0.12em] uppercase">
									{intent.eyebrow}
								</p>
								<h1 bind:this={detailHeadingElement} class="mt-1 text-xl font-medium" tabindex="-1">
									{entry.name}
								</h1>
								<p class="text-fg-secondary mt-2 max-w-2xl text-sm leading-6">
									{intent.description}
								</p>
							</div>
						</div>

						<div class="flex shrink-0 flex-col items-end gap-2">
							{#if needsRepositoryEnablement && !repositoryStateLoading}
								{#if repositoryEnabled}
									<span
										class="bg-success/10 text-success-content inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
										data-testid="extension-repository-enabled"
									>
										<Icon name="check" size={12} /> Enabled for this repository
									</span>
								{:else}
									<span class="bg-surface-50 text-fg-secondary rounded-full px-3 py-1.5 text-xs">
										Optional
									</span>
								{/if}
							{:else if entry.firstParty}
								<span
									class="bg-success/10 text-success-content inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
								>
									<Icon name="check" size={12} /> Always available
								</span>
							{/if}
						</div>
					</div>
				</section>

				{#if actionError}
					<section
						class="border-error/20 bg-error/10 flex items-start gap-3 rounded-xl border px-4 py-3"
						role="alert"
					>
						<Icon name="alert" size={16} class="text-error-content mt-0.5 shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="text-error-content text-sm leading-5">{actionError}</p>
							{#if repositoryEnabled}
								<Button
									class="mt-2"
									variant="secondary"
									size="sm"
									disabled={changing}
									data-navigation-target={panelNavigationTarget}
									data-navigation-path-id="expected-path:extension-detail.open-panel"
									onclick={retryStart}
								>
									Try starting again
								</Button>
							{/if}
						</div>
					</section>
				{/if}

				{#if needsRepositoryEnablement && !repositoryStateLoading && !repositoryEnabled}
					<section
						class="border-surface-100-border bg-surface-100 grid gap-4 rounded-2xl border p-5"
						data-testid="extension-enable-card"
					>
						<div>
							<h2 class="text-base font-medium">{intent.title}</h2>
							<p class="text-fg-secondary mt-1 text-sm leading-6">
								This changes only {repositoryLabel ?? 'the active repository'}. Nothing runs until
								you enable it.
							</p>
						</div>
						<ul class="text-fg-secondary grid gap-2 text-sm">
							{#each intent.outcomes as outcome (outcome)}
								<li class="flex gap-2">
									<Icon name="check" size={16} class="text-fg-tertiary mt-0.5 shrink-0" />
									{outcome}
								</li>
							{/each}
						</ul>
						<div>
							<Button
								variant="primary"
								disabled={changing || !extensionWorkstream}
								data-navigation-target={panelNavigationTarget}
								data-navigation-path-id="expected-path:extension-detail.open-panel"
								onclick={enableForRepository}
							>
								{changing ? 'Enabling…' : 'Enable for this repository'}
							</Button>
						</div>
					</section>
				{:else if enabled && primaryPanelId}
					<section
						class="border-surface-150-border bg-surface-150 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5"
					>
						<div>
							<h2 class="text-base font-medium">{intent.title}</h2>
							<p class="text-fg-secondary mt-1 text-sm leading-5">{intent.nextStep}</p>
						</div>
						<Button
							variant="primary"
							data-navigation-target={panelNavigationTarget}
							data-navigation-path-id="expected-path:extension-detail.open-panel"
							onclick={openPanel}
						>
							{intent.action}
						</Button>
					</section>
				{/if}

				{#if manifest && settingsAccess && enabled && settingsAccess.definitions(manifest).length > 0}
					<details class="border-surface-150-border bg-surface-150 rounded-2xl border">
						<summary class="cursor-pointer px-5 py-4 text-sm font-medium">Preferences</summary>
						<div class="border-border-subtle border-t p-5">
							<ExtensionSettingsForm
								{manifest}
								access={settingsAccess}
								workstreamId={extensionWorkstream?.id}
								repositoryPath={extensionWorkstream?.repositoryRootPath ??
									extensionWorkstream?.repositoryPath}
								repositoryFullName={extensionWorkstream?.repositoryFullName}
							/>
						</div>
					</details>
				{/if}

				<details class="border-surface-150-border bg-surface-150 rounded-2xl border">
					<summary class="cursor-pointer px-5 py-4 text-sm font-medium">
						About this extension
					</summary>
					<div class="border-border-subtle border-t p-5">
						<p class="text-fg-tertiary mb-4 text-xs">
							Built by {entry.author.name} · reviewed for this malini release
						</p>
						<DirectoryReadme markdown={entry.readme.markdown} />
					</div>
				</details>
			{/if}
		</main>
	</ScrollableDiv>
</div>
