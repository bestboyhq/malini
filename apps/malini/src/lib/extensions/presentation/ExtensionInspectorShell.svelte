<script lang="ts">
	import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';
	import { tick, untrack, type Snippet } from 'svelte';
	import { dismissOnOutside } from '$shared/shell/dismiss-on-outside';
	import { dockInspector } from '$shared/shell/inspector-dock.svelte';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';

	import { BrowserTab, roveTabFocus } from '$hyper-ui/components/browser-tab';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	import ExtensionGutter from './ExtensionGutter.svelte';
	import ExtensionPanelHost from './ExtensionPanelHost.svelte';
	import ExtensionPanelIcon from './ExtensionPanelIcon.svelte';
	import type { ExtensionPanelHostErrorHandler } from './extension-panel-host';
	import { gutterRows, type GutterChangeTotals } from '$shared/extensions/inspector-gutter-row';
	import { inspectorMinWidth } from '$shared/extensions/inspector-min-width';
	import {
		loadInspectorDirectoryTabOpen,
		saveInspectorDirectoryTabOpen,
	} from '$shared/extensions/inspector-directory-tab.store';
	import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';
	import { inspectorGutter } from '$shared/extensions/inspector-gutter.store.svelte';
	import {
		emptyInspectorPanelKeepAliveState,
		inspectorPanelKeepAliveEntry,
		reconcileInspectorPanelKeepAlive,
		type InspectorPanelKeepAliveState,
	} from '../domain/inspector-panel-keep-alive';
	import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';
	import {
		loadInspectorPanelPreferences,
		saveInspectorPanelPreferences,
	} from '$shared/extensions/inspector-panel-preferences.store';
	import {
		INSPECTOR_PANEL_PREFERENCES_VERSION,
		moveInspectorPanel,
		placeInspectorPanel,
		projectInspectorPanelPresentation,
		reconcileInspectorPanelPreferences,
		selectInspectorPanel,
		setInspectorPanelVisible,
		type InspectorPanelPreferences,
	} from '$shared/extensions/inspector-panel-preferences';
	import type { InspectorPreferenceStorage } from '$shared/extensions/inspector-preference-storage';

	interface Props {
		workstreamId: string;
		workstreamName?: string | null;
		changeTotals?: GutterChangeTotals | null;
		agentSessionId?: string | null;
		panels: readonly ExtensionPanelRegistration[];
		context: ExtensionPanelContext;
		ready?: boolean;
		runtimeError?: string | null;
		panelBadges?: Readonly<
			Record<string, Readonly<{ count: number; ariaLabel: string }> | null | undefined>
		>;
		addExtensionsHref?: string;
		closeDirectoryNavigationTarget?: string;
		addExtensionsActive?: boolean;
		addExtensionsContent?: Snippet;
		renderIcon?: Snippet<[icon: string, size: number]>;
		toolbarEnd?: Snippet;
		storage?: InspectorPreferenceStorage | null | undefined;
		onactivechange?: (panelId: string | null) => void;
		onpanelselect?: (panelId: string) => void;
		requestedPanelId?: string | null;
		onrequestedpanelhandled?: (panelId: string) => void;
		onpanelerror?: ExtensionPanelHostErrorHandler;
		onruntimeretry?: () => void;
	}

	let {
		workstreamId,
		workstreamName = null,
		changeTotals = null,
		agentSessionId = null,
		panels,
		context,
		ready = true,
		runtimeError = null,
		panelBadges = {},
		addExtensionsHref,
		closeDirectoryNavigationTarget,
		addExtensionsActive = false,
		addExtensionsContent,
		renderIcon,
		toolbarEnd,
		storage,
		onactivechange,
		onpanelselect,
		requestedPanelId = null,
		onrequestedpanelhandled,
		onpanelerror = () => undefined,
		onruntimeretry,
	}: Props = $props();

	let preferences: InspectorPanelPreferences = $state({
		version: INSPECTOR_PANEL_PREFERENCES_VERSION,
		order: [],
		hidden: [],
		activeId: null,
	});
	let loadedWorkstreamId: string | null = $state(null);
	let finalizedWorkstreamId: string | null = $state(null);
	let panelPickerOpen = $state(false);
	let panelPickerAnchor: HTMLSpanElement | null = $state(null);
	let directoryTab: HTMLDivElement | null = $state(null);
	let directoryTabStateRevision = $state(0);
	let settingsOpen = $state(false);
	let settingsAnchor: HTMLSpanElement | null = $state(null);
	let panelFailures: Readonly<Record<string, string>> = $state.raw({});
	let handledRequestedPanelId: string | null = $state(null);
	let openedPanelKey: string | null = null;
	let keepAlive: InspectorPanelKeepAliveState<ExtensionPanelRegistration, ExtensionPanelContext> =
		$state.raw(emptyInspectorPanelKeepAliveState());
	type PreferenceMutation = (current: InspectorPanelPreferences) => InspectorPanelPreferences;
	let pendingMutationWorkstreamId: string | null = null;
	let pendingPreferenceMutations: PreferenceMutation[] = [];

	const panelPresentation = $derived(projectInspectorPanelPresentation(panels, preferences));
	const presentedPreferences = $derived(panelPresentation.preferences);
	const visiblePanels = $derived(panelPresentation.visiblePanels);
	const orderedPanels = $derived(panelPresentation.orderedPanels);
	const activePanel = $derived(panelPresentation.activePanel);
	const inspectorInteractive = $derived(loadedWorkstreamId === workstreamId);
	const inspectorRuntimeReady = $derived(ready && inspectorInteractive);
	const presentedEntry = $derived(inspectorPanelKeepAliveEntry(keepAlive, workstreamId));
	const presentedPanelId = $derived(activePanel?.id ?? null);
	const presentsMountedPanel = $derived(
		presentedEntry?.panels.some(
			(panel) => panel.id === presentedPanelId && presentable(panel, inspectorRuntimeReady),
		) ?? false,
	);
	const activePanelMountsBeforeReady = $derived(
		activePanel !== null &&
			rendersContextWorkstream(activePanel) &&
			context.workstream?.id === workstreamId,
	);
	const rememberedDirectoryTabOpen = $derived.by(() => {
		directoryTabStateRevision;
		return loadInspectorDirectoryTabOpen(workstreamId, storage);
	});
	const directoryTabOpen = $derived(addExtensionsActive || rememberedDirectoryTabOpen);
	const DIRECTORY_TAB_KEY = 'extension-directory';
	const inspectorTabKeys = $derived([
		...visiblePanels.map(({ id }) => id),
		...(addExtensionsHref && directoryTabOpen ? [DIRECTORY_TAB_KEY] : []),
	]);
	const selectedInspectorTabKey = $derived(
		addExtensionsActive ? DIRECTORY_TAB_KEY : presentedPreferences.activeId,
	);
	const inspectorTabStopKey = $derived(
		inspectorTabKeys.find((key) => key === selectedInspectorTabKey) ?? inspectorTabKeys[0],
	);
	const inspectorTabsId = $props.id();
	const controlledPanelId = $derived.by((): string | null => {
		if (addExtensionsActive) return addExtensionsContent ? DIRECTORY_TAB_KEY : null;
		return presentsMountedPanel ? presentedPanelId : null;
	});
	const drawerOpen = $derived(inspectorDrawer.isOpen(workstreamId, storage));
	const floating = $derived(drawerOpen && inspectorDrawer.overlay);
	const compactRows = $derived(
		gutterRows({
			panels: orderedPanels,
			hiddenPanelIds: presentedPreferences.hidden,
			changeTotals,
		}),
	);
	const minWidth = $derived(inspectorMinWidth(orderedPanels, presentedPreferences.hidden));

	const gutterSource = {
		workstreamId: () => workstreamId,
		minWidth: () => minWidth,
	};

	$effect(() => inspectorGutter.connect(gutterSource));

	const activeDocumentId = $derived(workstreamTabs.for(workstreamId).activeDocumentId);

	$effect(() => {
		if (activeDocumentId === null) return;
		if (untrack(() => floating)) closeDrawer();
	});

	$effect(() => {
		if (!inspectorInteractive) {
			panelPickerOpen = false;
			settingsOpen = false;
		}
	});

	$effect(() => {
		const panel = activePanel;
		const panelContext = context;
		if (!inspectorRuntimeReady || addExtensionsActive || !drawerOpen || !panel) {
			openedPanelKey = null;
			return;
		}
		const key = `${workstreamId}:${panel.id}`;
		if (openedPanelKey === key) return;
		openedPanelKey = key;
		notifyPanelOpened(panel, panelContext, key);
	});

	$effect(() => {
		if (!addExtensionsActive) return;
		void (async () => {
			await tick();
			directoryTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		})();
	});

	$effect(() => {
		if (!addExtensionsActive) return;
		openDrawer();
	});

	$effect(() => {
		const next = reconcileInspectorPanelKeepAlive(keepAlive, {
			workstreamId,
			panels,
			hiddenPanelIds: presentedPreferences.hidden,
			activePanelId: activePanel?.id ?? null,
			ready: inspectorRuntimeReady,
			allowActivePanelMount: !addExtensionsActive && drawerOpen,
			mountBeforeReady: activePanelMountsBeforeReady,
			context,
		});
		if (next !== keepAlive) keepAlive = next;
		const retainedPanelKeys = new Set(
			next.entries.flatMap((entry) =>
				entry.panels.map(({ id }) => panelFailureKey(entry.workstreamId, id)),
			),
		);
		const retainedFailures = Object.fromEntries(
			Object.entries(panelFailures).filter(([key]) => retainedPanelKeys.has(key)),
		);
		if (Object.keys(retainedFailures).length !== Object.keys(panelFailures).length) {
			panelFailures = retainedFailures;
		}
	});

	$effect(() => {
		const requested = requestedPanelId;
		if (!requested) {
			handledRequestedPanelId = null;
			return;
		}
		if (
			!inspectorInteractive ||
			handledRequestedPanelId === requested ||
			!panels.some(({ id }) => id === requested)
		) {
			return;
		}
		handledRequestedPanelId = requested;
		openPanel(requested);
		onrequestedpanelhandled?.(requested);
	});

	$effect(() => {
		const request = inspectorPanelCommands.requestFor(workstreamId);
		if (!request || !inspectorInteractive) return;
		if (!panels.some((panel) => panel.id === request.panelId)) return;
		openPanel(request.panelId);
		inspectorPanelCommands.consume(workstreamId, request.revision);
	});

	$effect(() => {
		if (workstreamId !== loadedWorkstreamId) {
			if (panels.length === 0) return;
			loadedWorkstreamId = workstreamId;
			finalizedWorkstreamId = null;
			pendingMutationWorkstreamId = workstreamId;
			pendingPreferenceMutations = [];
			const loaded = loadInspectorPanelPreferences(workstreamId, panels, storage);
			replacePreferences(loaded, true);
		}

		if (loadedWorkstreamId !== workstreamId) return;

		if (!ready) {
			if (finalizedWorkstreamId !== workstreamId) {
				const provisional = replayPendingMutations(
					workstreamId,
					loadInspectorPanelPreferences(workstreamId, panels, storage),
				);
				if (JSON.stringify(provisional) !== JSON.stringify(preferences)) {
					replacePreferences(provisional);
				}
			}
			return;
		}

		if (finalizedWorkstreamId !== workstreamId) {
			const finalized = replayPendingMutations(
				workstreamId,
				loadInspectorPanelPreferences(workstreamId, panels, storage),
			);
			replacePreferences(finalized);
			finalizedWorkstreamId = workstreamId;
			pendingMutationWorkstreamId = null;
			pendingPreferenceMutations = [];
			return;
		}

		const reconciled = reconcileInspectorPanelPreferences(panels, preferences);
		if (JSON.stringify(reconciled) !== JSON.stringify(preferences)) {
			replacePreferences(reconciled);
		}
	});

	function replayPendingMutations(
		workstream: string,
		base: InspectorPanelPreferences,
	): InspectorPanelPreferences {
		if (pendingMutationWorkstreamId !== workstream) return base;
		return pendingPreferenceMutations.reduce((current, mutation) => mutation(current), base);
	}

	function replacePreferences(next: InspectorPanelPreferences, notifyAlways = false): void {
		const previousActiveId = preferences.activeId;
		if (JSON.stringify(next) !== JSON.stringify(preferences)) preferences = next;
		if (notifyAlways || next.activeId !== previousActiveId) onactivechange?.(next.activeId);
	}

	function persist(mutation: PreferenceMutation): InspectorPanelPreferences {
		if (!inspectorInteractive) return preferences;
		const current = reconcileInspectorPanelPreferences(panels, preferences);
		const next = mutation(current);
		const projectionChanged = JSON.stringify(current) !== JSON.stringify(preferences);
		const mutationChanged = JSON.stringify(next) !== JSON.stringify(current);
		if (!projectionChanged && !mutationChanged) return preferences;

		if (mutationChanged && finalizedWorkstreamId !== workstreamId) {
			if (pendingMutationWorkstreamId !== workstreamId) {
				pendingMutationWorkstreamId = workstreamId;
				pendingPreferenceMutations = [];
			}
			pendingPreferenceMutations.push(mutation);
		}

		replacePreferences(next);
		if (finalizedWorkstreamId === workstreamId) {
			saveInspectorPanelPreferences(workstreamId, next, storage);
		}
		return next;
	}

	function selectPanel(panelId: string): void {
		if (!inspectorInteractive) return;
		persist((current) => selectInspectorPanel(current, panelId));
		onpanelselect?.(panelId);
	}

	function openDrawer(): void {
		inspectorDrawer.open(workstreamId, storage);
	}

	function closeDrawer(): void {
		inspectorDrawer.close(workstreamId, storage);
		panelPickerOpen = false;
		settingsOpen = false;
	}

	function openPanel(panelId: string): void {
		if (!inspectorInteractive) return;
		openDrawer();
		persist((current) => {
			const visible = setInspectorPanelVisible(current, panelId, true);
			return selectInspectorPanel(visible, panelId);
		});
		panelPickerOpen = false;
		onpanelselect?.(panelId);
		void focusPanelTab(panelId);
	}

	async function focusPanelTab(panelId: string | null): Promise<void> {
		if (!panelId) return;
		await tick();
		document
			.querySelector<HTMLElement>(
				`[data-testid="extension-inspector-tab"][data-panel-id="${CSS.escape(panelId)}"]`,
			)
			?.focus({ preventScroll: true });
	}

	function closePanel(event: MouseEvent, panelId: string): void {
		event.preventDefault();
		event.stopPropagation();
		if (!inspectorInteractive || visiblePanels.length <= 1) return;

		const closingIndex = visiblePanels.findIndex((panel) => panel.id === panelId);
		const closingPanel = visiblePanels[closingIndex];
		const adjacentPanel =
			closingIndex >= 0
				? (visiblePanels[closingIndex + 1] ?? visiblePanels[closingIndex - 1] ?? null)
				: null;
		const wasActive = !addExtensionsActive && presentedPreferences.activeId === panelId;
		const next = persist((current) => {
			let updated = setInspectorPanelVisible(current, panelId, false);
			if (wasActive && adjacentPanel) {
				updated = selectInspectorPanel(updated, adjacentPanel.id);
			}
			return updated;
		});
		clearPanelFailure(panelId);
		notifyPanelClosed(closingPanel);
		if (wasActive) void focusPanelTab(adjacentPanel?.id ?? next.activeId);
	}

	function closeExtensionDirectory(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (!inspectorInteractive) return;
		rememberDirectoryTabOpen(false);
		const panelId = presentedPreferences.activeId;
		if (panelId) onpanelselect?.(panelId);
		void focusPanelTab(panelId);
	}

	function rememberDirectoryTabOpen(open: boolean): void {
		saveInspectorDirectoryTabOpen(workstreamId, open, storage);
		directoryTabStateRevision += 1;
	}

	function togglePanel(panelId: string): void {
		const isVisible = !presentedPreferences.hidden.includes(panelId);
		const next = persist((current) => setInspectorPanelVisible(current, panelId, !isVisible));
		if (isVisible && next.hidden.includes(panelId)) {
			clearPanelFailure(panelId);
			notifyPanelClosed(panels.find((panel) => panel.id === panelId));
		} else if (!isVisible) {
			clearPanelFailure(panelId);
		}
	}

	function clearPanelFailure(panelId: string): void {
		const key = panelFailureKey(workstreamId, panelId);
		if (!(key in panelFailures)) return;
		panelFailures = Object.fromEntries(
			Object.entries(panelFailures).filter(([failedKey]) => failedKey !== key),
		);
	}

	function panelFailureKey(failedWorkstreamId: string, panelId: string): string {
		return JSON.stringify([failedWorkstreamId, panelId]);
	}

	function presentable(panel: ExtensionPanelRegistration, runtimeReady: boolean): boolean {
		return runtimeReady || rendersContextWorkstream(panel);
	}

	function rendersContextWorkstream(panel: ExtensionPanelRegistration): boolean {
		return panel.component.workstreamScope === 'context';
	}

	function notifyPanelClosed(panel: ExtensionPanelRegistration | undefined): void {
		if (!panel?.onDidClose) return;
		void (async () => {
			try {
				await panel.onDidClose?.();
			} catch (cause) {
				panelError(cause, panel);
			}
		})();
	}

	function notifyPanelOpened(
		panel: ExtensionPanelRegistration,
		panelContext: ExtensionPanelContext,
		key: string,
	): void {
		if (!panel.onDidOpen) return;
		void (async () => {
			try {
				await panel.onDidOpen?.(panelContext);
			} catch (cause) {
				if (openedPanelKey !== key || (cause instanceof Error && cause.name === 'AbortError'))
					return;
				panelError(cause, panel);
			}
		})();
	}

	function movePanel(panelId: string, direction: -1 | 1): void {
		persist((current) => moveInspectorPanel(current, panelId, direction));
	}

	let draggingPanelId = $state<string | null>(null);
	let draggingIndex = $state<number | null>(null);
	let dragOverGap = $state<number | null>(null);
	let arrangeList: HTMLElement | null = $state(null);

	const dropLineGap = $derived.by(() => {
		if (draggingIndex === null || dragOverGap === null) return null;
		if (dragOverGap === draggingIndex || dragOverGap === draggingIndex + 1) return null;
		return dragOverGap;
	});

	function gapAt(clientY: number): number | null {
		if (!arrangeList) return null;
		const rows = Array.from(arrangeList.querySelectorAll<HTMLElement>('[data-arrange-row]'));
		if (rows.length === 0) return null;
		for (const [index, row] of rows.entries()) {
			const box = row.getBoundingClientRect();
			if (clientY < box.top + box.height / 2) return index;
		}
		return rows.length;
	}

	function startPanelDrag(event: PointerEvent, panelId: string, index: number): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		draggingPanelId = panelId;
		draggingIndex = index;
		dragOverGap = index;
	}

	function movePanelDrag(event: PointerEvent): void {
		if (draggingPanelId === null) return;
		const gap = gapAt(event.clientY);
		if (gap !== null) dragOverGap = gap;
	}

	function endPanelDrag(event: PointerEvent): void {
		if (draggingPanelId === null || draggingIndex === null) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLElement)) return;
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
		const panelId = draggingPanelId;
		const from = draggingIndex;
		const gap = dragOverGap;
		cancelPanelDrag();
		if (gap === null) return;
		persist((current) => placeInspectorPanel(current, panelId, gap > from ? gap - 1 : gap));
	}

	function cancelPanelDrag(): void {
		draggingPanelId = null;
		draggingIndex = null;
		dragOverGap = null;
	}

	function arrangeKeydown(event: KeyboardEvent, panelId: string): void {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		movePanel(panelId, event.key === 'ArrowUp' ? -1 : 1);
	}

	function panelError(
		cause: unknown,
		panel: ExtensionPanelRegistration | null,
		failedWorkstreamId: string = workstreamId,
	): void {
		const panelId = panel?.id ?? 'unknown';
		panelFailures = {
			...panelFailures,
			[panelFailureKey(failedWorkstreamId, panelId)]:
				cause instanceof Error && cause.message
					? cause.message
					: 'The extension panel could not be opened.',
		};
		onpanelerror(cause, panel);
	}

	function inspectorTabId(key: string): string {
		return `${inspectorTabsId}-tab-${encodeURIComponent(key)}`;
	}

	function inspectorPanelId(key: string): string {
		return `${inspectorTabsId}-panel-${encodeURIComponent(key)}`;
	}

	function controlledPanel(key: string): string | undefined {
		return key === controlledPanelId ? inspectorPanelId(key) : undefined;
	}

	function compactBadgeCount(count: number): string {
		const normalized = Math.max(0, Math.floor(count));
		return normalized > 99 ? '99+' : String(normalized);
	}
</script>

{#if floating}
	<div class="mr-3 w-72 shrink-0" aria-hidden="true"></div>
{/if}

<section
	class={[
		'bg-surface-50 border-surface-50-border mt-1 mr-3 mb-3 flex min-h-0 min-w-0 shrink flex-col overflow-hidden rounded-3xl border-[0.5px] [html[data-native-shell=true]_&]:z-[51] [html[data-native-shell=true]_&]:mt-4',
		floating
			? 'shadow-popup absolute top-0 right-0 z-10 max-h-[calc(100%-1.75rem)]'
			: 'relative z-10',
		!drawerOpen && 'w-72',
	]}
	style:width={floating ? `min(calc(100% - 3rem), max(${minWidth}px, 50%))` : undefined}
	{@attach dockInspector(!drawerOpen)}
	{@attach floating && dismissOnOutside(closeDrawer, '[data-inspector-dock]')}
	aria-label="Inspector"
	aria-busy={drawerOpen &&
		!inspectorRuntimeReady &&
		!presentsMountedPanel &&
		!runtimeError &&
		!addExtensionsActive}
	data-workstream-id={workstreamId}
	data-navigation-workstream-id={workstreamId}
	data-workstream-ready={inspectorRuntimeReady}
	data-inspector-drawer-open={drawerOpen}
	data-testid="extension-inspector-shell"
>
	{#if drawerOpen}
		<div class="flex h-12 shrink-0 items-center gap-1 px-4 pt-1">
			<div
				class="absolute"
				role="tablist"
				aria-label="Inspector panels"
				aria-owns={inspectorTabKeys.map((key) => inspectorTabId(key)).join(' ')}
			></div>
			<div
				class="inspector-tab-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
				use:roveTabFocus
			>
				{#each visiblePanels as panel, panelIndex (panel.id)}
					{@const isActive = !addExtensionsActive && panel.id === presentedPreferences.activeId}
					{@const badge = panelBadges[panel.id]}
					{@const adjacentPanelId = isActive
						? (visiblePanels[panelIndex + 1]?.id ?? visiblePanels[panelIndex - 1]?.id ?? null)
						: null}
					<BrowserTab
						label={panel.label}
						selected={isActive}
						disabled={!inspectorInteractive}
						tabId={inspectorTabId(panel.id)}
						tabindex={panel.id === inspectorTabStopKey ? 0 : -1}
						ariaControls={controlledPanel(panel.id)}
						closeLabel={`Close ${panel.label}`}
						closeDisabled={!inspectorInteractive || visiblePanels.length <= 1}
						data-active={String(isActive)}
						data-panel-id={panel.id}
						tabAttributes={{
							'data-testid': 'extension-inspector-tab',
							'data-navigation-target': addExtensionsActive
								? closeDirectoryNavigationTarget
								: undefined,
							'data-navigation-local-target':
								isActive || addExtensionsActive ? undefined : 'extension-inspector-panel',
							'data-navigation-path-id': addExtensionsActive
								? 'expected-path:extension-directory.close'
								: 'expected-path:extension-inspector.select-panel',
							'data-navigation-target-workstream-id': workstreamId,
							'data-navigation-panel-id': panel.id,
							'data-panel-id': panel.id,
						}}
						closeAttributes={{
							'data-testid': 'extension-inspector-tab-close',
							'data-navigation-local-target': adjacentPanelId
								? 'extension-inspector-panel'
								: undefined,
							'data-navigation-target-workstream-id': adjacentPanelId ? workstreamId : undefined,
							'data-navigation-panel-id': adjacentPanelId ?? undefined,
							'data-navigation-path-id': 'expected-path:extension-inspector.close-panel',
							'data-panel-id': panel.id,
						}}
						onselect={() => selectPanel(panel.id)}
						onclose={(event) => closePanel(event, panel.id)}
					>
						{#snippet icon()}
							<span class="grid place-items-center" aria-hidden="true">
								{#if renderIcon}{@render renderIcon(panel.icon, 14)}{:else}<ExtensionPanelIcon
										icon={panel.icon}
										size={14}
									/>{/if}
							</span>
						{/snippet}
						{#snippet trailing()}
							{#if badge}
								<span
									class={[
										'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
										isActive ? 'bg-surface-100-selected' : 'bg-surface-50-selected',
										badge.count > 0 ? 'text-fg-default' : 'text-fg-tertiary',
									]}
									aria-label={badge.ariaLabel}
									data-testid="extension-inspector-tab-badge"
									data-panel-id={panel.id}
									data-count={badge.count}
								>
									{compactBadgeCount(badge.count)}
								</span>
							{/if}
						{/snippet}
					</BrowserTab>
				{/each}

				{#if addExtensionsHref && directoryTabOpen}
					<div bind:this={directoryTab} class="contents">
						<BrowserTab
							label="Extensions"
							selected={addExtensionsActive}
							href={addExtensionsHref}
							tabId={inspectorTabId(DIRECTORY_TAB_KEY)}
							tabindex={inspectorTabStopKey === DIRECTORY_TAB_KEY ? 0 : -1}
							ariaControls={controlledPanel(DIRECTORY_TAB_KEY)}
							closeLabel="Close Extensions"
							data-active={String(addExtensionsActive)}
							data-panel-id="extension-directory"
							tabAttributes={{
								'data-testid': 'add-extension-panel',
								'data-navigation-path-id': 'expected-path:extension-directory.open',
							}}
							closeAttributes={{
								'data-testid': 'extension-directory-tab-close',
								'data-navigation-target': closeDirectoryNavigationTarget,
								'data-navigation-path-id': 'expected-path:extension-directory.close',
							}}
							onclose={closeExtensionDirectory}
						>
							{#snippet icon()}
								<span class="grid place-items-center" aria-hidden="true">
									<Icon name="grid-plus" size={14} />
								</span>
							{/snippet}
						</BrowserTab>
					</div>
				{/if}

				<span class="shrink-0" bind:this={panelPickerAnchor}>
					<Tooltip content="Open inspector panel" placement="bottom" suppressed={panelPickerOpen}>
						<IconButton
							ariaLabel="Open inspector panel"
							variant="ghost"
							ariaHasPopup="menu"
							ariaExpanded={panelPickerOpen}
							disabled={!inspectorInteractive}
							class="text-fg-tertiary h-7 w-7 rounded-md"
							data-testid="extension-inspector-add"
							onclick={() => {
								settingsOpen = false;
								panelPickerOpen = !panelPickerOpen;
							}}
						>
							<Icon name="plus" size={13} />
						</IconButton>
					</Tooltip>
				</span>
			</div>

			{#if toolbarEnd}
				<span class="flex shrink-0 items-center">{@render toolbarEnd()}</span>
			{/if}
			<span class="shrink-0" bind:this={settingsAnchor}>
				<Tooltip content="Arrange inspector panels" placement="bottom" suppressed={settingsOpen}>
					<IconButton
						ariaLabel="Arrange inspector panels"
						variant="ghost"
						size="md"
						active={settingsOpen}
						ariaHasPopup="menu"
						ariaExpanded={settingsOpen}
						disabled={!inspectorInteractive}
						onclick={() => {
							panelPickerOpen = false;
							settingsOpen = !settingsOpen;
						}}
					>
						<Icon name="settings" size={14} />
					</IconButton>
				</Tooltip>
			</span>
			<span class="shrink-0">
				<Tooltip content="Hide inspector" placement="bottom">
					<IconButton
						ariaLabel="Hide inspector"
						variant="ghost"
						size="md"
						ariaExpanded={true}
						data-testid="extension-inspector-hide"
						onclick={closeDrawer}
					>
						<Icon name="chevron-right" size={13} />
					</IconButton>
				</Tooltip>
			</span>
		</div>

		<DropdownLayer
			open={panelPickerOpen}
			anchor={panelPickerAnchor}
			onclose={() => (panelPickerOpen = false)}
			side="bottom"
			align="start"
			owner="extension-inspector-panel-picker"
			testId="extension-inspector-panel-picker"
			panelClass="w-60 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1"
		>
			<div class="text-fg-tertiary px-2 py-1.5 text-xs">Open panel</div>
			{#each orderedPanels as panel (panel.id)}
				{@const isOpen = !presentedPreferences.hidden.includes(panel.id)}
				{@const isSelected = !addExtensionsActive && panel.id === presentedPreferences.activeId}
				<DropdownItem
					role="menuitem"
					closeOnSelect={false}
					focusOnHover={false}
					aria-label={`${isOpen ? 'Select' : 'Open'} ${panel.label}`}
					data-testid="extension-inspector-picker-item"
					data-navigation-target={addExtensionsActive ? closeDirectoryNavigationTarget : undefined}
					data-navigation-local-target={isSelected || addExtensionsActive
						? undefined
						: 'extension-inspector-panel'}
					data-navigation-path-id={addExtensionsActive
						? 'expected-path:extension-directory.close'
						: isOpen
							? 'expected-path:extension-inspector.select-panel'
							: 'expected-path:extension-inspector.open-panel'}
					data-navigation-target-workstream-id={workstreamId}
					data-navigation-panel-id={panel.id}
					data-panel-id={panel.id}
					onclick={() => openPanel(panel.id)}
				>
					<span
						class="text-fg-tertiary grid h-4 w-4 shrink-0 place-items-center"
						aria-hidden="true"
					>
						{#if renderIcon}{@render renderIcon(panel.icon, 13)}{:else}<ExtensionPanelIcon
								icon={panel.icon}
								size={13}
							/>{/if}
					</span>
					<span class="min-w-0 flex-1 truncate">{panel.label}</span>
					{#if isSelected}
						<span class="text-fg-default" aria-label="Selected">
							<Icon name="check" size={11} />
						</span>
					{:else if !isOpen}
						<span class="text-fg-tertiary" aria-label="Closed">
							<Icon name="plus" size={11} />
						</span>
					{/if}
				</DropdownItem>
			{/each}
			{#if addExtensionsHref}
				<div class="border-border-subtle my-1 border-t"></div>
				<a
					href={addExtensionsHref}
					data-navigation-path-id="expected-path:extension-directory.open"
					role="menuitem"
					aria-current={addExtensionsActive ? 'page' : undefined}
					aria-label="Add extensions"
					data-testid="add-extension-panel-option"
					class="text-fg-secondary hover:bg-surface-elevated-hover hover:text-fg-default focus-visible:bg-surface-elevated-hover flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs outline-none"
					onclick={() => {
						panelPickerOpen = false;
						rememberDirectoryTabOpen(true);
					}}
				>
					<span
						class="text-fg-tertiary grid h-4 w-4 shrink-0 place-items-center"
						aria-hidden="true"
					>
						<Icon name="grid-plus" size={13} />
					</span>
					<span class="min-w-0 flex-1 truncate">Add extensions</span>
					{#if addExtensionsActive}
						<span class="text-fg-default" aria-label="Selected">
							<Icon name="check" size={11} />
						</span>
					{/if}
				</a>
			{/if}
		</DropdownLayer>

		<DropdownLayer
			open={settingsOpen}
			anchor={settingsAnchor}
			onclose={() => (settingsOpen = false)}
			side="bottom"
			align="end"
			owner="extension-inspector-preferences"
			testId="extension-inspector-preferences"
			panelClass="w-72 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1"
		>
			<div class="text-fg-tertiary px-2 py-1.5 text-xs">Inspector panels</div>
			<div bind:this={arrangeList} data-testid="extension-inspector-arrange-list">
				{#each orderedPanels as panel, index (panel.id)}
					{@const isVisible = !presentedPreferences.hidden.includes(panel.id)}
					{@const hideActiveTargetPanelId =
						isVisible && !addExtensionsActive && panel.id === presentedPreferences.activeId
							? (visiblePanels.find((candidate) => candidate.id !== panel.id)?.id ?? null)
							: null}
					<div
						class={[
							'arrange-row hover:bg-surface-elevated-hover relative flex h-8 items-center gap-1 rounded-md px-1',
							draggingPanelId === panel.id && 'opacity-50',
						]}
						data-arrange-row
						data-panel-id={panel.id}
						data-drop-before={dropLineGap === index}
						data-drop-after={dropLineGap === orderedPanels.length &&
							index === orderedPanels.length - 1}
					>
						<span
							class="text-fg-tertiary grid h-6 w-6 shrink-0 place-items-center"
							aria-hidden="true"
						>
							{#if renderIcon}{@render renderIcon(panel.icon, 13)}{:else}<ExtensionPanelIcon
									icon={panel.icon}
									size={13}
								/>{/if}
						</span>
						<span class="text-fg-secondary min-w-0 flex-1 truncate text-xs">{panel.label}</span>
						<Tooltip
							content={isVisible ? `Hide ${panel.label}` : `Show ${panel.label}`}
							placement="top"
						>
							<IconButton
								ariaLabel={isVisible ? `Hide ${panel.label}` : `Show ${panel.label}`}
								variant="ghost"
								size="sm"
								data-navigation-local-target={hideActiveTargetPanelId
									? 'extension-inspector-panel'
									: undefined}
								data-navigation-target-workstream-id={hideActiveTargetPanelId
									? workstreamId
									: undefined}
								data-navigation-panel-id={hideActiveTargetPanelId ?? undefined}
								data-navigation-path-id="expected-path:extension-inspector.hide-active-panel"
								onclick={() => togglePanel(panel.id)}
							>
								{#if isVisible}<Icon name="eye" size={12} />{:else}<Icon
										name="eye-off"
										size={12}
									/>{/if}
							</IconButton>
						</Tooltip>
						<Tooltip
							content={`Drag to reorder ${panel.label}`}
							placement="top"
							suppressed={draggingPanelId !== null}
						>
							<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- a drag handle: pointer capture and the grab cursor live on the element itself, which IconButton does not expose. -->
							<button
								type="button"
								class="text-fg-secondary hover:text-fg-default focus-visible:ring-border-default/50 grid h-6 w-6 shrink-0 touch-none place-items-center rounded outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
								class:cursor-grab={draggingPanelId === null}
								class:cursor-grabbing={draggingPanelId !== null}
								aria-label={`Reorder ${panel.label}. Drag, or press the arrow keys`}
								data-testid="extension-inspector-arrange-handle"
								data-panel-id={panel.id}
								disabled={orderedPanels.length <= 1}
								onpointerdown={(event) => startPanelDrag(event, panel.id, index)}
								onpointermove={movePanelDrag}
								onpointerup={endPanelDrag}
								onpointercancel={cancelPanelDrag}
								onkeydown={(event) => arrangeKeydown(event, panel.id)}
							>
								<Icon name="grip" size={12} />
							</button>
						</Tooltip>
					</div>
				{/each}
			</div>
		</DropdownLayer>

		{#if addExtensionsActive && addExtensionsContent}
			<div
				class="relative flex min-h-0 min-w-0 flex-1"
				id={inspectorPanelId(DIRECTORY_TAB_KEY)}
				role="tabpanel"
				aria-labelledby={inspectorTabId(DIRECTORY_TAB_KEY)}
				data-testid="extension-inspector-content"
				data-panel-id="extension-directory"
				data-navigation-workstream-id={workstreamId}
			>
				{@render addExtensionsContent()}
			</div>
		{:else if runtimeError}
			<div
				class="grid min-h-0 flex-1 place-items-center p-6"
				role="alert"
				data-testid="inspector-runtime-error"
				data-navigation-error="true"
				data-navigation-error-message={runtimeError}
				data-navigation-workstream-id={workstreamId}
				data-navigation-panel-id={requestedPanelId ?? activePanel?.id ?? undefined}
				data-navigation-agent-session-id={agentSessionId ?? undefined}
			>
				<div
					class="border-surface-elevated-border bg-surface-elevated max-w-96 rounded-lg border-[0.5px] p-4"
				>
					<p class="text-fg-secondary text-sm font-medium">Workstream inspector did not start</p>
					<p class="text-fg-tertiary mt-1 text-xs leading-relaxed">{runtimeError}</p>
					{#if onruntimeretry}
						<Button
							variant="secondary"
							bordered
							class="border-surface-150-border bg-surface-150 hover:bg-surface-150-hover mt-3 h-8 px-3 text-xs"
							data-testid="inspector-runtime-retry"
							onclick={onruntimeretry}
						>
							Retry
						</Button>
					{/if}
				</div>
			</div>
		{:else if !inspectorRuntimeReady && !presentsMountedPanel}
			<div
				class="min-h-0 flex-1"
				data-testid="inspector-cold-shell"
				data-navigation-cold-shell="true"
				data-navigation-workstream-id={workstreamId}
				data-navigation-panel-id={requestedPanelId ?? activePanel?.id ?? undefined}
				data-navigation-agent-session-id={agentSessionId ?? undefined}
				aria-label="Workstream tools unavailable until local panels are registered"
			></div>
		{:else if !activePanel && (presentedEntry?.panels.length ?? 0) === 0}
			<div class="grid min-h-0 flex-1 place-items-center px-6 text-center">
				<p class="text-fg-tertiary max-w-64 text-sm">No inspector panels are registered.</p>
			</div>
		{/if}
	{:else}
		<ExtensionGutter
			{workstreamId}
			{workstreamName}
			rows={compactRows}
			disabled={!inspectorInteractive}
			{renderIcon}
			onopen={openPanel}
			onshow={openDrawer}
		/>
	{/if}

	{#each keepAlive.entries as entry (entry.workstreamId)}
		{#each entry.panels as mountedPanel (mountedPanel.id)}
			{@const isPresented =
				drawerOpen &&
				!addExtensionsActive &&
				entry.workstreamId === workstreamId &&
				mountedPanel.id === presentedPanelId &&
				presentable(mountedPanel, inspectorRuntimeReady)}
			{@const isActive =
				isPresented && (inspectorRuntimeReady || rendersContextWorkstream(mountedPanel))}
			{@const failure = panelFailures[panelFailureKey(entry.workstreamId, mountedPanel.id)]}
			<div
				class="relative flex min-h-0 min-w-0 flex-1"
				class:hidden={!isPresented}
				id={isPresented ? inspectorPanelId(mountedPanel.id) : undefined}
				role="tabpanel"
				aria-labelledby={inspectorTabId(mountedPanel.id)}
				inert={!isActive}
				aria-hidden={!isPresented}
				data-testid={isPresented ? 'extension-inspector-content' : undefined}
				data-inspector-panel-cache
				data-panel-id={mountedPanel.id}
				data-navigation-workstream-id={entry.workstreamId}
				data-navigation-panel-id={mountedPanel.id}
			>
				<ExtensionPanelHost
					panel={mountedPanel}
					context={entry.context}
					workstreamId={entry.workstreamId}
					onerror={(cause, failedPanel) => panelError(cause, failedPanel, entry.workstreamId)}
				/>
				{#if failure}
					<div
						class="absolute inset-0 grid place-items-center p-6"
						data-navigation-error="true"
						data-navigation-error-message={failure}
						data-navigation-workstream-id={entry.workstreamId}
						data-navigation-panel-id={mountedPanel.id}
						data-navigation-agent-session-id={agentSessionId ?? undefined}
					>
						<div
							class="border-surface-elevated-border bg-surface-elevated max-w-80 rounded-lg border-[0.5px] p-3"
						>
							<p class="text-fg-secondary text-sm">{mountedPanel.label} is unavailable</p>
							<p class="text-fg-tertiary mt-1 text-xs">{failure}</p>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{/each}
</section>

<style>
	.arrange-row[data-drop-before='true']::before,
	.arrange-row[data-drop-after='true']::after {
		content: '';
		position: absolute;
		right: 0.25rem;
		left: 0.25rem;
		height: 2px;
		border-radius: 1px;
		background: var(--color-brand);
	}
	.arrange-row[data-drop-before='true']::before {
		top: -1px;
	}
	.arrange-row[data-drop-after='true']::after {
		bottom: -1px;
	}
</style>
