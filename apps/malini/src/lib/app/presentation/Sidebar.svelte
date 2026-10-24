<script lang="ts">
	import { afterNavigate, goto } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount, tick } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide, type SlideParams } from 'svelte/transition';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		connectedRepositoryContexts,
		hiddenRepositoriesQuery,
		moveInSidebarCommand,
		sidebarOrderQuery,
		type SidebarMove,
	} from '$shared/repositories/repositories.api';
	import { reorderIndex, reorderShift, settledOffset, type SidebarSlot } from './sidebar-reorder';
	import { collapsedGroupsQuery } from '$lib/app/application/queries/collapsed-groups.query.svelte';
	import { sidebarDensityQuery } from '$lib/app/application/queries/sidebar-density.query.svelte';
	import { toggleGroupCollapsedCommand } from '$lib/app/application/commands/toggle-group-collapsed.command';
	import {
		groupItems,
		repositoryGroups,
		showsInSidebar,
		type OwnerGroup,
		type RepositoryGroup,
	} from '$lib/app/domain/repository-groups';
	import { WorkstreamRunningLine } from '$lib/stats/stats.api';
	import { watchWorkstreamRunningHook } from '$lib/stats/application/hooks/watch-workstream-running.hook';
	import { workstreamRunningQuery } from '$lib/stats/application/queries/workstream-running.query.svelte';
	import { openBrowserUrlCommand } from '$lib/browser/application/commands/open-browser-url.command';
	import { stopRunningCommand } from '$lib/stats/application/commands/stop-running.command';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import StagedUpdateButton from './StagedUpdateButton.svelte';
	import { ScratchpadIdeasCount, ScratchpadIdeasPreview } from '$lib/scratchpad/scratchpad.api';
	import { WorkstreamChatSummary } from '$lib/chat/chat.api';
	import {
		provisioningRecordQuery,
		workstreamNativeExistenceQuery,
		workstreamSettingUpQuery,
		type WorkstreamChangeTotals,
		type WorkstreamProvisioningRecord,
	} from '$shared/repositories/repositories.api';
	import { displayWorkstreamName } from '$shared/repositories/repositories.api';
	import { namedWorkstreamsQuery } from '$shared/repositories/repositories.api';
	import type {
		PullRequestBadge,
		PullRequestPhase,
	} from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import { formatCompactChangeTotal } from '$lib/pull-requests/pull-requests.api';
	import type {
		ConnectedRepositoryContext,
		Repository,
	} from '$shared/repositories/repositories.api';
	import type { Workstream } from '$shared/repositories/repositories.api';
	import { isWorkstreamCheckoutUsable } from '$shared/repositories/repositories.api';
	import {
		ConnectRepositoryContextMenu,
		type ConnectRepositoryContextMenuTarget,
		RepositoryAvatar,
		RepositoryContextMenu,
		type RepositoryContextMenuTarget,
		WorkstreamContextMenu,
		type WorkstreamContextMenuTarget,
	} from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { RenameText } from '$hyper-ui/components/rename-text';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';
	import WorkstreamRunningCard from './WorkstreamRunningCard.svelte';
	import SidebarArchived from './SidebarArchived.svelte';
	import { REPOSITORIES_HREF, repositoryHref, workstreamHref } from '$shared/router/routes-hrefs';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { RepositorySidebarSkeleton } from '$shared/repositories/repositories.api';
	import { describeFailure } from '$shared/errors/failure-copy';

	interface Props {
		repositories: readonly Repository[];
		workstreams: readonly Workstream[];
		activeWorkstreamId: string;
		scopeLoading?: boolean;
		scopeError?: string | null;
		onRetryScope?: () => void;
		onNewWorkstream: (repo: Repository) => void;
		onArchiveWorkstream?: (workstream: Workstream) => void;
		onRemoveRepository?: (repo: Repository, workstreams: readonly Workstream[]) => void;
		changeTotalsByWorkstream?: Readonly<Record<string, WorkstreamChangeTotals>>;
		pullRequestBadge?: (workstreamId: string) => PullRequestBadge;
	}

	let {
		repositories,
		workstreams,
		activeWorkstreamId,
		scopeLoading = false,
		scopeError = null,
		onRetryScope,
		onNewWorkstream,
		onArchiveWorkstream,
		onRemoveRepository,
		changeTotalsByWorkstream = {},
		pullRequestBadge = unknownPullRequestBadge,
	}: Props = $props();
	const provisioningRecord = $derived(provisioningRecordQuery.data);
	const settingUp = $derived(workstreamSettingUpQuery.data);
	const nativeExistence = $derived(workstreamNativeExistenceQuery.data);
	const workstreamRunning = $derived(workstreamRunningQuery.data);
	const scopeFailure = $derived(
		scopeError ? describeFailure(scopeError, { subject: 'Workstream data' }) : null,
	);
	const sidebarOrder = $derived(sidebarOrderQuery.data);
	const collapsedGroupIds = $derived(collapsedGroupsQuery.data);
	const compact = $derived(sidebarDensityQuery.data === 'compact');
	let reorder = $state<SidebarReorder | null>(null);
	let settling = false;
	let clickSuppressed = false;
	let optimisticDestination = $state<{
		target: string;
		workstreamId: string | null;
	} | null>(null);
	let activeNavigationHandle: ReturnType<typeof runtimeDiagnostics.beginNavigation> | null = null;
	let activeNavigationTarget: string | null = null;
	let previewCleanupTimer: ReturnType<typeof setTimeout> | null = null;
	let contextMenu = $state.raw<WorkstreamContextMenuTarget | null>(null);
	let repositoryMenu = $state.raw<RepositoryContextMenuTarget | null>(null);
	let connectMenu = $state.raw<ConnectRepositoryContextMenuTarget | null>(null);
	let contextMenuKeyboardRow: HTMLElement | null = null;

	const hiddenRepositoryIds = $derived(hiddenRepositoriesQuery.data);
	const openRepositoryId = $derived(page.params.repositoryId ?? null);
	const contexts = $derived(
		connectedRepositoryContexts({
			repositories,
			workstreams,
			activeWorkstreamId,
			order: sidebarOrder,
		}),
	);
	const unhiddenRows = $derived(contexts.filter((row) => !hiddenRepositoryIds.has(row.repo.id)));
	const everyRepositoryHidden = $derived(contexts.length > 0 && unhiddenRows.length === 0);
	const rows = $derived(unhiddenRows.filter((row) => showsInSidebar(row, openRepositoryId)));
	const entries = $derived(repositoryGroups(rows, (row) => row.repo));
	const entryIds = $derived(entries.map((entry) => entry.id));
	const repositoryIdsByEntry = $derived(
		new Map(entries.map((entry) => [entry.id, entryRepositoryIds(entry)])),
	);
	const listedRepositoryIds = $derived(entries.flatMap(entryRepositoryIds));
	const avatarSize = $derived(compact ? 16 : 20);
	const listedWorkstreamIds = $derived(
		rows.flatMap((row) => row.workstreams.map((workstream) => workstream.id)),
	);
	const pendingWorkstreamId = $derived(optimisticDestination?.workstreamId ?? null);
	const visuallyActiveWorkstreamId = $derived(pendingWorkstreamId ?? activeWorkstreamId);

	afterNavigate(() => {
		clearPreviewCleanupTimer();
		optimisticDestination = null;
		activeNavigationTarget = null;
		activeNavigationHandle = null;
	});

	function rowHref(
		targetWorkstreamId: string | null | undefined,
		targetSessionId: string | null = null,
	): string {
		if (!targetWorkstreamId) return REPOSITORIES_HREF;
		return workstreamHref(targetWorkstreamId, { agentSessionId: targetSessionId });
	}

	function workstreamCountLabel(count: number): string {
		if (count === 0) return 'No workstreams';
		return `${count} ${count === 1 ? 'workstream' : 'workstreams'}`;
	}

	function repositoryCountLabel(count: number): string {
		return `${count} ${count === 1 ? 'repository' : 'repositories'}`;
	}

	function openNewWorkstream(repo: Repository): void {
		onNewWorkstream(repo);
	}

	function clearPreviewCleanupTimer(): void {
		if (previewCleanupTimer === null) return;
		clearTimeout(previewCleanupTimer);
		previewCleanupTimer = null;
	}

	function clearDestinationPreview(target?: string): void {
		if (target && optimisticDestination?.target !== target) return;
		clearPreviewCleanupTimer();
		if (!target || optimisticDestination?.target === target) optimisticDestination = null;
	}

	function previewWorkstreamDestination(
		targetWorkstreamId: string | null | undefined,
		targetSessionId: string | null = null,
	): string | null {
		const target = rowHref(targetWorkstreamId, targetSessionId);
		if (`${page.url.pathname}${page.url.search}` === target) {
			clearDestinationPreview();
			return null;
		}
		clearPreviewCleanupTimer();
		optimisticDestination = {
			target,
			workstreamId: targetWorkstreamId ?? null,
		};
		return target;
	}

	function previewDestinationFromPointer(
		event: PointerEvent,
		targetWorkstreamId: string | null | undefined,
		targetSessionId: string | null = null,
	): void {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		previewWorkstreamDestination(targetWorkstreamId, targetSessionId);
	}

	function previewDestinationFromKeyboard(
		event: KeyboardEvent,
		targetWorkstreamId: string | null | undefined,
		targetSessionId: string | null = null,
	): void {
		if (
			event.defaultPrevented ||
			event.key !== 'Enter' ||
			event.repeat ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		previewWorkstreamDestination(targetWorkstreamId, targetSessionId);
	}

	function scheduleAbandonedDestinationPreviewCleanup(target: string): void {
		clearPreviewCleanupTimer();
		previewCleanupTimer = setTimeout(() => {
			previewCleanupTimer = null;
			if (activeNavigationTarget === target) return;
			clearDestinationPreview(target);
		}, 0);
	}

	function abandonDestinationPreview(target: string): void {
		if (activeNavigationTarget === target) return;
		clearDestinationPreview(target);
	}

	function abandonUnclaimedDestinationPreview(): void {
		const target = optimisticDestination?.target;
		if (!target) return;
		if (activeNavigationTarget === target) return;
		clearDestinationPreview(target);
	}

	onMount(() => watchWorkstreamRunningHook());

	onMount(() => {
		globalThis.addEventListener('blur', abandonUnclaimedDestinationPreview);
		return () => {
			globalThis.removeEventListener('blur', abandonUnclaimedDestinationPreview);
		};
	});

	function scheduleKeyboardDestinationPreviewCleanup(event: KeyboardEvent, target: string): void {
		if (event.key === 'Enter') scheduleAbandonedDestinationPreviewCleanup(target);
	}

	function beginWorkstreamNavigation(
		event: MouseEvent,
		targetWorkstreamId: string | null | undefined,
		label: string,
		targetSessionId: string | null = null,
	): void {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		const target = rowHref(targetWorkstreamId, targetSessionId);
		if (`${page.url.pathname}${page.url.search}` === target) {
			optimisticDestination = null;
			clearDestinationPreview();
			activeNavigationTarget = null;
			activeNavigationHandle?.cancel();
			activeNavigationHandle = null;
			return;
		}
		previewWorkstreamDestination(targetWorkstreamId, targetSessionId);
		activeNavigationHandle?.cancel();
		activeNavigationTarget = target;
		activeNavigationHandle = runtimeDiagnostics.beginNavigation(target, `Opening ${label}`);
	}

	onDestroy(() => {
		clearPreviewCleanupTimer();
		optimisticDestination = null;
		activeNavigationTarget = null;
		activeNavigationHandle?.cancel();
		activeNavigationHandle = null;
	});

	function opensMenu(event: KeyboardEvent): boolean {
		return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
	}

	function menuAnchor(event: MouseEvent | KeyboardEvent): { x: number; y: number } | null {
		if (!(event.currentTarget instanceof HTMLElement)) return null;
		event.preventDefault();
		const row = event.currentTarget;
		const box = row.getBoundingClientRect();
		const pointer = event instanceof MouseEvent ? pointerInside(event, box) : null;
		contextMenuKeyboardRow = pointer ? null : row;
		return pointer ?? { x: box.left, y: box.bottom };
	}

	function openWorkstreamMenu(event: MouseEvent | KeyboardEvent, workstreamId: string): void {
		const at = menuAnchor(event);
		if (at) contextMenu = { workstreamId, ...at };
	}

	function openRepositoryMenu(
		event: MouseEvent | KeyboardEvent,
		repository: Repository,
		workstreams: readonly Workstream[],
	): void {
		const at = menuAnchor(event);
		if (at) repositoryMenu = { repository, workstreams, ...at };
	}

	function openConnectMenu(event: MouseEvent): void {
		if (event.defaultPrevented) return;
		event.preventDefault();
		contextMenuKeyboardRow = null;
		connectMenu = { x: event.clientX, y: event.clientY };
	}

	function pointerInside(event: MouseEvent, box: DOMRect): { x: number; y: number } | null {
		const inside =
			event.clientX >= box.left &&
			event.clientX <= box.right &&
			event.clientY >= box.top &&
			event.clientY <= box.bottom;
		return inside ? { x: event.clientX, y: event.clientY } : null;
	}

	function closeContextMenu(): void {
		contextMenu = null;
		repositoryMenu = null;
		connectMenu = null;
		contextMenuKeyboardRow?.focus({ preventScroll: true });
		contextMenuKeyboardRow = null;
	}

	function exitTargetWhenRemoved(workstreamId: string): string | undefined {
		return workstreamId === activeWorkstreamId ? REPOSITORIES_HREF : undefined;
	}

	function leaveRemovedWorkstream(workstreamId: string): void {
		if (workstreamId === activeWorkstreamId) void goto(REPOSITORIES_HREF);
	}

	function openRunningPort(workstreamId: string, sessionId: string | null, port: number): void {
		if (workstreamId !== activeWorkstreamId) void goto(rowHref(workstreamId, sessionId));
		openBrowserUrlCommand(workstreamId, `http://localhost:${port}`);
	}

	function requestArchive(event: MouseEvent, workstream: Workstream): void {
		event.preventDefault();
		event.stopPropagation();
		onArchiveWorkstream?.(workstream);
	}

	function workstreamLabel(workstream: Workstream, repositoryFullName: string): string {
		return displayWorkstreamName(workstream, repositoryFullName);
	}

	type WorkstreamLifecycleAction = Readonly<{
		kind: 'archive' | 'discard' | 'blocked';
		archivesNatively: boolean;
		ariaLabel: string;
		tooltip: string;
	}>;

	function lifecycleAction(workstreamId: string, label: string): WorkstreamLifecycleAction {
		const existence = nativeExistence(workstreamId);
		if (existence === 'absent') {
			return {
				kind: 'discard',
				archivesNatively: false,
				ariaLabel: `Remove ${label}`,
				tooltip: 'Remove workstream',
			};
		}
		if (existence === 'in-flight') {
			return {
				kind: 'blocked',
				archivesNatively: false,
				ariaLabel: `Archive ${label}`,
				tooltip: 'Still setting up. Archive once setup finishes or fails.',
			};
		}
		return {
			kind: 'archive',
			archivesNatively: true,
			ariaLabel: `Archive ${label}`,
			tooltip: 'Archive workstream',
		};
	}

	type SidebarItem = Readonly<{ kind: SidebarMove['kind']; id: string }>;

	type SidebarReorder = Readonly<{
		item: SidebarItem;
		siblingIds: readonly string[];
		slots: readonly SidebarSlot[];
		from: number;
		to: number;
		offset: number;
	}>;

	const foldMotion = (): SlideParams => ({
		duration: prefersReducedMotion.current ? 0 : 240,
		easing: quartOut,
	});

	const REORDER_THRESHOLD_PX = 4;
	const SETTLE_MS = 150;

	function listedIds(kind: SidebarMove['kind']): readonly string[] {
		return kind === 'repository' ? listedRepositoryIds : listedWorkstreamIds;
	}

	function entryRepositoryIds(entry: RepositoryGroup<ConnectedRepositoryContext>): string[] {
		return groupItems(entry).map((row) => row.repo.id);
	}

	function movedIds(kind: SidebarMove['kind'], id: string): readonly string[] {
		if (kind === 'workstream') return [id];
		return repositoryIdsByEntry.get(id) ?? [id];
	}

	function reorderSiblings(row: HTMLElement): HTMLElement[] {
		return [...(row.parentElement?.children ?? [])].filter(
			(element): element is HTMLElement =>
				element instanceof HTMLElement && element.dataset['sidebarItem'] !== undefined,
		);
	}

	function beginReorder(row: HTMLElement, item: SidebarItem): SidebarReorder | null {
		const siblings = reorderSiblings(row);
		const from = siblings.indexOf(row);
		if (from === -1 || siblings.length < 2) return null;
		return {
			item,
			siblingIds: siblings.map((sibling) => sibling.dataset['sidebarItem'] ?? ''),
			slots: siblings.map((sibling) => {
				const { top, bottom } = sibling.getBoundingClientRect();
				return { top, bottom };
			}),
			from,
			to: from,
			offset: 0,
		};
	}

	function armReorder(event: PointerEvent, item: SidebarItem): void {
		if (event.button !== 0 || reorder || settling) return;
		const row = event.currentTarget;
		if (!(row instanceof HTMLElement) || !(event.target instanceof Element)) return;
		if (
			event.target.closest('button:not([data-sidebar-grip])') ||
			event.target.closest('[data-sidebar-item]') !== row
		)
			return;
		const { pointerId, clientY: startY } = event;
		let dragging = false;

		const track = (move: PointerEvent): void => {
			if (move.pointerId !== pointerId || settling) return;
			const offset = move.clientY - startY;
			if (!dragging) {
				if (Math.abs(offset) < REORDER_THRESHOLD_PX) return;
				reorder = beginReorder(row, item);
				if (!reorder) return disarm();
				dragging = true;
				abandonUnclaimedDestinationPreview();
			}
			if (!reorder) return;
			reorder = { ...reorder, offset, to: reorderIndex(reorder.slots, reorder.from, offset) };
		};
		const release = (end: PointerEvent): void => {
			if (end.pointerId !== pointerId) return;
			disarm();
			if (!dragging) return;
			suppressNextClick();
			if (!settling) settleReorder(row, end.type === 'pointerup');
		};
		const cancel = (key: KeyboardEvent): void => {
			if (key.key !== 'Escape' || !dragging || settling) return;
			key.preventDefault();
			key.stopPropagation();
			settleReorder(row, false);
		};
		function disarm(): void {
			window.removeEventListener('pointermove', track);
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
			window.removeEventListener('keydown', cancel, true);
		}
		window.addEventListener('pointermove', track);
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
		window.addEventListener('keydown', cancel, true);
	}

	function settleReorder(row: HTMLElement, commit: boolean): void {
		const current = reorder;
		if (!current) return;
		const to = commit ? current.to : current.from;
		const offset = settledOffset(current.slots, current.from, to);
		settling = true;
		reorder = { ...current, to, offset };
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const settle = row.animate(
			[{ transform: `translateY(${current.offset}px)` }, { transform: `translateY(${offset}px)` }],
			{ duration: reducedMotion ? 0 : SETTLE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
		);
		const finish = (): void => {
			settling = false;
			reorder = null;
			const targetId = current.siblingIds[to];
			if (to === current.from || !targetId) return;
			moveInSidebarCommand({
				kind: current.item.kind,
				listedIds: listedIds(current.item.kind),
				movedIds: movedIds(current.item.kind, current.item.id),
				targetIds: movedIds(current.item.kind, targetId),
				placement: to > current.from ? 'after' : 'before',
			});
		};
		settle.onfinish = finish;
		settle.oncancel = finish;
	}

	function suppressNextClick(): void {
		clickSuppressed = true;
		setTimeout(() => {
			clickSuppressed = false;
		}, 0);
	}

	function swallowDragClick(event: MouseEvent): void {
		if (!clickSuppressed) return;
		clickSuppressed = false;
		event.preventDefault();
		event.stopPropagation();
	}

	function reorderTransform(id: string): string | undefined {
		if (!reorder) return undefined;
		const index = reorder.siblingIds.indexOf(id);
		if (index === -1) return undefined;
		const y =
			index === reorder.from
				? reorder.offset
				: reorderShift(reorder.slots, reorder.from, reorder.to, index);
		return y === 0 ? undefined : `translateY(${y}px)`;
	}

	function reorderClass(id: string): string | undefined {
		if (!reorder?.siblingIds.includes(id)) return undefined;
		if (reorder.item.id === id) return 'bg-surface-50 z-10 rounded-xl shadow-md';
		return 'transition-transform duration-150 ease-out motion-reduce:transition-none';
	}

	async function onMoveKey(
		event: KeyboardEvent,
		kind: SidebarMove['kind'],
		id: string,
		siblingIds: readonly string[],
	): Promise<void> {
		if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const placement = event.key === 'ArrowUp' ? 'before' : 'after';
		const index = siblingIds.indexOf(id);
		const targetId = siblingIds[placement === 'before' ? index - 1 : index + 1];
		if (index === -1 || !targetId) return;
		const focused = event.currentTarget;
		moveInSidebarCommand({
			kind,
			listedIds: listedIds(kind),
			movedIds: movedIds(kind, id),
			targetIds: movedIds(kind, targetId),
			placement,
		});
		await tick();
		if (focused instanceof HTMLElement) focused.focus();
	}

	type WorkstreamVisualState = {
		label: string;
		icon: string;
		tone:
			| 'idle'
			| 'provisioning'
			| 'running'
			| 'background'
			| 'waiting'
			| 'completed'
			| 'failed'
			| 'queued'
			| 'draft'
			| 'broken';
	};

	type ChatTone =
		'running' | 'background' | 'waiting' | 'queued' | 'failed' | 'completed' | 'draft';

	type ChatAttention = Readonly<{ kind: 'completed' | 'input' | 'failed' | 'approval' }>;

	type ChatSummary = Readonly<{
		sessionId: string | null;
		queueCount: number;
		attention: ChatAttention | null;
		needsYou: boolean;
		hasDraft: boolean;
		state: Readonly<{ label: string; tone: ChatTone }> | null;
	}>;

	const CHAT_TONE_ICON: Readonly<Record<ChatTone, string>> = {
		running: 'text-fg-secondary',
		background: 'text-fg-secondary',
		waiting: 'text-warning-content',
		queued: 'text-fg-secondary',
		failed: 'text-error-content',
		completed: 'text-fg-secondary',
		draft: 'text-fg-secondary',
	};

	function visualState(
		workstream: Workstream,
		provisioning: WorkstreamProvisioningRecord | null,
		chat: ChatSummary,
	): WorkstreamVisualState {
		if (provisioning?.failure) {
			return { label: 'Setup failed', icon: 'text-error-content', tone: 'failed' };
		}
		if (provisioning) {
			return { label: 'Creating', icon: 'text-fg-secondary', tone: 'provisioning' };
		}
		if (settingUp(workstream.id)) {
			return { label: 'Setting up', icon: 'text-fg-secondary', tone: 'provisioning' };
		}
		if (!isWorkstreamCheckoutUsable(workstream)) {
			return {
				label: workstream.checkoutIssue ?? 'Its checkout is missing',
				icon: 'text-error-content',
				tone: 'broken',
			};
		}
		if (chat.state) {
			return {
				label: chat.state.label,
				icon: CHAT_TONE_ICON[chat.state.tone],
				tone: chat.state.tone,
			};
		}
		return {
			label: workstream.status === 'active' ? 'Idle' : workstream.status,
			icon: workstream.status === 'active' ? 'text-fg-tertiary' : 'text-fg-tertiary/60',
			tone: 'idle',
		};
	}

	type PullRequestVisual = Readonly<{
		glyph: 'branch' | 'pr-draft' | 'pr-open' | 'pr-merged' | 'alert';
		color: string;
		label: string | null;
	}>;

	const PULL_REQUEST_PHASE_VISUALS: Readonly<
		Record<PullRequestPhase, Omit<PullRequestVisual, 'label'>>
	> = {
		none: { glyph: 'branch', color: '' },
		draft: { glyph: 'pr-draft', color: '' },
		open: { glyph: 'pr-open', color: '' },
		queued: { glyph: 'pr-open', color: 'text-brand-icon' },
		'needs-you': { glyph: 'alert', color: 'text-warning-content' },
		merged: { glyph: 'pr-merged', color: 'text-merged-content' },
		unknown: { glyph: 'branch', color: '' },
	};

	function pullRequestVisual(badge: PullRequestBadge): PullRequestVisual {
		return { ...PULL_REQUEST_PHASE_VISUALS[badge.phase], label: badge.label };
	}

	function statusIconColor(
		state: WorkstreamVisualState,
		busy: boolean,
		pullRequest: PullRequestVisual,
	): string {
		if (state.tone === 'background') return pullRequest.color || state.icon;
		return busy || state.tone === 'broken' ? state.icon : pullRequest.color;
	}

	function unknownPullRequestBadge(): PullRequestBadge {
		return { phase: 'unknown', label: null };
	}

	function attentionLabel(attention: ChatAttention): string {
		if (attention.kind === 'failed') return 'Agent run needs attention';
		if (attention.kind === 'approval') return 'Agent is waiting for approval';
		return 'Agent needs your input';
	}

	function visualStateTooltip(
		state: WorkstreamVisualState,
		chat: ChatSummary,
		pullRequest: PullRequestVisual,
	): string {
		return [
			state.label,
			pullRequest.label,
			chat.hasDraft ? 'Unsent draft' : null,
			chat.needsYou && chat.attention ? attentionLabel(chat.attention) : null,
		]
			.filter(Boolean)
			.join(' · ');
	}

	type WorkstreamView = Readonly<{
		label: string;
		chat: ChatSummary;
		state: WorkstreamVisualState;
		lifecycle: WorkstreamLifecycleAction;
		targetSessionId: string | null;
		badge: PullRequestBadge;
		changeTotals: WorkstreamChangeTotals | undefined;
		pullRequest: PullRequestVisual;
		busy: boolean;
		loading: boolean;
		selected: boolean;
		running: ReturnType<typeof workstreamRunning>;
	}>;

	function workstreamView(
		workstream: Workstream,
		repositoryFullName: string,
		chat: ChatSummary,
	): WorkstreamView {
		const label = workstreamLabel(workstream, repositoryFullName);
		const state = visualState(workstream, provisioningRecord(workstream.id), chat);
		const badge = pullRequestBadge(workstream.id);
		const busy =
			state.tone === 'running' || state.tone === 'background' || state.tone === 'provisioning';
		return {
			label,
			chat,
			state,
			lifecycle: lifecycleAction(workstream.id, label),
			targetSessionId: chat.sessionId,
			badge,
			changeTotals: badge.phase === 'merged' ? undefined : changeTotalsByWorkstream[workstream.id],
			pullRequest: pullRequestVisual(badge),
			busy,
			loading: busy || (badge.phase === 'queued' && state.tone !== 'broken'),
			selected: workstream.id === visuallyActiveWorkstreamId,
			running: workstreamRunning(workstream.id),
		};
	}

	function workstreamLinkData(
		workstream: Workstream,
		repositoryFullName: string,
		view: WorkstreamView,
	): Record<`data-${string}`, string | undefined> {
		return {
			'data-testid': 'sidebar-workstream',
			'data-workstream-id': workstream.id,
			'data-navigation-workstream-id': workstream.id,
			'data-navigation-pending': workstream.id === pendingWorkstreamId ? 'true' : undefined,
			'data-navigation-feedback-only': 'true',
			'data-repository-full-name': repositoryFullName,
			'data-workstream-state': view.state.tone,
			'data-workstream-checkout': workstream.checkoutState,
			'data-workstream-draft': view.chat.hasDraft ? 'true' : undefined,
		};
	}
</script>

{#snippet statusGlyph(loading: boolean, background: boolean, glyph: PullRequestVisual['glyph'])}
	{#if loading}
		<BusyIcon size={14} {background} />
	{:else}
		<Icon name={glyph} size={14} />
	{/if}
{/snippet}

{#snippet ownerFolder(folder: OwnerGroup<ConnectedRepositoryContext>)}
	{@const collapsed = collapsedGroupIds.has(folder.id)}
	{@const siblingIds = folder.items.map((row) => row.repo.id)}
	{@const first = folder.items[0]}
	<li
		class={['relative w-full min-w-0', reorderClass(folder.id)]}
		style:transform={reorderTransform(folder.id)}
		data-sidebar-item={folder.id}
		onpointerdown={(event) => armReorder(event, { kind: 'repository', id: folder.id })}
	>
		<Button
			bare
			class={[
				'text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 outline-none',
				compact ? 'h-7 text-xs' : 'h-8 text-sm',
			]}
			ariaLabel={`${folder.owner}, ${repositoryCountLabel(folder.items.length)}`}
			ariaExpanded={!collapsed}
			ariaControls={`owner-repositories-${folder.id}`}
			ariaKeyshortcuts="Alt+ArrowUp Alt+ArrowDown"
			data-sidebar-grip=""
			data-testid="sidebar-owner-folder"
			data-owner={folder.owner}
			onclick={() => toggleGroupCollapsedCommand(folder.id)}
			onkeydown={(event) => void onMoveKey(event, 'repository', folder.id, entryIds)}
		>
			<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
				{#if first}
					<RepositoryAvatar fullName={first.repo.fullName} size={avatarSize} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate text-left leading-relaxed font-medium">
				{folder.owner}
			</span>
			<span class="text-3xs text-fg-tertiary shrink-0 font-mono font-medium tabular-nums">
				{folder.items.length}
			</span>
			<Icon
				name="chevron-down"
				class={`text-fg-tertiary shrink-0 transition-transform duration-100 ${collapsed ? '-rotate-90' : ''}`}
				size={13}
			/>
		</Button>
		<ul
			id={`owner-repositories-${folder.id}`}
			class={['flex w-full flex-col gap-0.5', collapsed && 'hidden']}
		>
			{#each folder.items as row (row.repo.id)}
				{@render repositoryGroup(row, true, siblingIds)}
			{/each}
		</ul>
	</li>
{/snippet}

{#snippet repositoryGroup(
	row: ConnectedRepositoryContext,
	nested: boolean,
	siblingIds: readonly string[],
)}
	{@const collapsed = collapsedGroupIds.has(row.repo.id)}
	<li
		class={['relative w-full min-w-0', reorderClass(row.repo.id)]}
		style:transform={reorderTransform(row.repo.id)}
		data-sidebar-item={row.repo.id}
		onpointerdown={(event) => armReorder(event, { kind: 'repository', id: row.repo.id })}
	>
		<HoverCard
			side="right"
			align="start"
			sideOffset={12}
			openDelay={500}
			triggerPress="dismiss"
			triggerClass="w-full"
			panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-3"
			testId="sidebar-repository-card"
		>
			{#snippet trigger()}
				<div
					class={[
						'group/repo text-fg-secondary relative flex w-full items-center gap-2 rounded-xl pr-1',
						nested ? 'pl-6' : 'pl-2',
						compact ? 'h-7' : 'h-8',
						row.repo.id === openRepositoryId
							? 'bg-surface-50-selected'
							: 'hover:bg-surface-50-hover has-focus-visible:bg-surface-50-hover data-[active=true]:bg-surface-50-hover',
					]}
					data-active={row.repo.id === repositoryMenu?.repository.id}
					data-testid="sidebar-connected-repository"
					data-full-name={row.repo.fullName}
					data-workstream-count={row.workstreams.length}
				>
					<div
						class={nested
							? 'absolute top-1/2 left-0.5 z-10 h-5 w-5 -translate-y-1/2'
							: 'relative z-10 h-5 w-5 shrink-0'}
					>
						{#if !nested}
							<span
								class="absolute inset-0 grid place-items-center group-hover/repo:opacity-0 group-has-focus-visible/repo:opacity-0"
								aria-hidden="true"
								data-testid="sidebar-repository-icon"
							>
								<RepositoryAvatar fullName={row.repo.fullName} size={avatarSize} />
							</span>
						{/if}
						<Tooltip
							content={`${collapsed ? 'Expand' : 'Collapse'} ${row.repo.fullName}`}
							placement="right"
							class="absolute inset-0"
						>
							<IconButton
								bare
								onclick={() => toggleGroupCollapsedCommand(row.repo.id)}
								ariaLabel={`${collapsed ? 'Expand' : 'Collapse'} ${row.repo.fullName}`}
								ariaExpanded={!collapsed}
								ariaControls={`repository-workstreams-${row.repo.id}`}
								class="text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-default focus-visible:ring-border-default/50 pointer-events-none grid h-5 w-5 cursor-pointer place-items-center rounded opacity-0 group-hover/repo:pointer-events-auto group-hover/repo:opacity-100 group-has-focus-visible/repo:pointer-events-auto group-has-focus-visible/repo:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
								data-testid="sidebar-repository-disclosure"
							>
								<Icon
									name="chevron-down"
									class={`transition-transform duration-100 ${collapsed ? '-rotate-90' : ''}`}
									size={13}
								/>
							</IconButton>
						</Tooltip>
					</div>
					<a
						href={repositoryHref(row.repo.id)}
						data-navigation-path-id="expected-path:workstream-sidebar.repository"
						aria-label={`Open ${row.repo.fullName}`}
						aria-describedby={`repository-notes-${row.repo.id}`}
						aria-current={row.repo.id === openRepositoryId ? 'page' : undefined}
						class="hover:text-fg-default focus-visible:text-fg-default min-w-0 flex-1 outline-none before:absolute before:inset-0 before:content-['']"
						aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+F10"
						onkeydown={(event) => {
							if (opensMenu(event)) {
								openRepositoryMenu(event, row.repo, row.workstreams);
								return;
							}
							void onMoveKey(event, 'repository', row.repo.id, siblingIds);
						}}
						oncontextmenu={(event) => openRepositoryMenu(event, row.repo, row.workstreams)}
						draggable="false"
					>
						<span
							class={[
								'block truncate leading-relaxed font-medium',
								compact ? 'text-xs' : 'text-sm',
								row.repo.id === openRepositoryId
									? 'text-fg-default'
									: 'text-fg-secondary group-hover/repo:text-fg-default group-data-[active=true]/repo:text-fg-default',
							]}
						>
							{row.name}
						</span>
					</a>
					<ScratchpadIdeasCount
						repositoryFullName={row.repo.fullName}
						descriptionId={`repository-notes-${row.repo.id}`}
						class="shrink-0"
					/>
					{@render newWorkstreamButton(row.repo, '')}
				</div>
			{/snippet}
			{#snippet content()}
				{@render repositoryCard(row)}
			{/snippet}
		</HoverCard>
		<ul
			id={`repository-workstreams-${row.repo.id}`}
			class={['flex w-full flex-col', collapsed && 'hidden']}
		>
			{#each row.workstreams as workstream (workstream.id)}
				{@render workstreamItem(workstream, row, nested)}
			{/each}
		</ul>
	</li>
{/snippet}

{#snippet workstreamItem(workstream: Workstream, row: ConnectedRepositoryContext, nested: boolean)}
	<li
		class={['group/row relative mt-0.5 w-full min-w-0', reorderClass(workstream.id)]}
		style:transform={reorderTransform(workstream.id)}
		data-sidebar-item={workstream.id}
		onpointerdown={(event) => armReorder(event, { kind: 'workstream', id: workstream.id })}
		transition:slide={foldMotion()}
	>
		<WorkstreamChatSummary workstreamId={workstream.id}>
			{#snippet children(chat)}
				{@const view = workstreamView(workstream, row.repo.fullName, chat)}
				{#snippet card()}
					{@render runningCard(workstream, view)}
				{/snippet}
				<Tooltip
					content={card}
					interactive
					placement="right"
					suppressed={!view.running}
					class="w-full min-w-0"
				>
					<a
						draggable="false"
						href={rowHref(workstream.id, view.targetSessionId)}
						data-navigation-path-id="expected-path:workstream-sidebar.switch"
						aria-current={workstream.id === activeWorkstreamId ? 'page' : undefined}
						aria-busy={workstream.id === pendingWorkstreamId || undefined}
						class={[
							'sidebar-row relative w-full flex-col items-stretch pr-3 outline-none group-hover/row:pr-8 group-has-focus-visible/row:pr-8',
							nested ? 'pl-9' : 'pl-6',
							compact && 'py-1 text-xs',
							view.chat.attention !== null
								? 'text-500'
								: 'text-fg-tertiary group-hover/row:text-fg-secondary focus-visible:text-fg-secondary data-[active=true]:text-fg-secondary',
							view.selected
								? 'sidebar-row-active'
								: 'group-hover/row:bg-surface-50-hover focus-visible:bg-surface-50-hover data-[active=true]:bg-surface-50-hover',
						]}
						data-active={workstream.id === contextMenu?.workstreamId}
						{...workstreamLinkData(workstream, row.repo.fullName, view)}
						onpointerdown={(event) =>
							previewDestinationFromPointer(event, workstream.id, view.targetSessionId)}
						onpointerup={() =>
							scheduleAbandonedDestinationPreviewCleanup(
								rowHref(workstream.id, view.targetSessionId),
							)}
						onpointercancel={() =>
							abandonDestinationPreview(rowHref(workstream.id, view.targetSessionId))}
						onpointerleave={() =>
							abandonDestinationPreview(rowHref(workstream.id, view.targetSessionId))}
						aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+F10"
						onkeydown={(event) => {
							if (opensMenu(event)) {
								openWorkstreamMenu(event, workstream.id);
								return;
							}
							previewDestinationFromKeyboard(event, workstream.id, view.targetSessionId);
							void onMoveKey(
								event,
								'workstream',
								workstream.id,
								row.workstreams.map((sibling) => sibling.id),
							);
						}}
						onkeyup={(event) =>
							scheduleKeyboardDestinationPreviewCleanup(
								event,
								rowHref(workstream.id, view.targetSessionId),
							)}
						onblur={() =>
							scheduleAbandonedDestinationPreviewCleanup(
								rowHref(workstream.id, view.targetSessionId),
							)}
						onclick={(event) =>
							beginWorkstreamNavigation(event, workstream.id, view.label, view.targetSessionId)}
						oncontextmenu={(event) => openWorkstreamMenu(event, workstream.id)}
					>
						<span class="relative flex items-center gap-2">
							{@render statusIndicator(view)}
							{#if view.chat.attention && view.chat.needsYou}
								{@render attentionDot(view.chat.attention, '-left-3.5')}
							{/if}
							<span class="sidebar-row-text gap-1.5">
								{@render workstreamName(workstream, view, 40)}
								{@render workstreamTrail(view)}
							</span>
						</span>
						{#if view.running}
							<span class="pl-6" transition:slide={foldMotion()}>
								<WorkstreamRunningLine running={view.running} selected={view.selected} />
							</span>
						{/if}
					</a>
					{@render archiveButton(
						workstream,
						view,
						compact
							? 'absolute top-1 right-1 h-lh items-center text-xs leading-relaxed'
							: 'absolute top-1.5 right-1 h-lh items-center text-sm leading-relaxed',
					)}
				</Tooltip>
			{/snippet}
		</WorkstreamChatSummary>
	</li>
{/snippet}

{#snippet statusIndicator(view: WorkstreamView)}
	<Tooltip
		content={visualStateTooltip(view.state, view.chat, view.pullRequest)}
		placement="right"
		suppressed={view.running !== null}
		class="relative z-10 shrink-0"
	>
		<span
			class={[
				'grid h-4 w-4 place-items-center',
				statusIconColor(view.state, view.busy, view.pullRequest),
			]}
			role="status"
			aria-label={`Workstream status: ${visualStateTooltip(view.state, view.chat, view.pullRequest)}`}
			data-testid={view.state.tone === 'running' || view.state.tone === 'background'
				? 'sidebar-workstream-loader'
				: 'sidebar-workstream-status'}
			data-workstream-icon-state={view.state.tone}
			data-workstream-pull-request-state={view.badge.phase}
		>
			{@render statusGlyph(view.loading, view.state.tone === 'background', view.pullRequest.glyph)}
		</span>
	</Tooltip>
{/snippet}

{#snippet attentionDot(attention: ChatAttention, offset: string)}
	<span
		class={[
			'absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full',
			offset,
			attention.kind === 'failed' ? 'bg-error-content' : 'bg-warning-content',
		]}
		aria-hidden="true"
		data-testid="sidebar-agent-attention"
		data-attention-kind={attention.kind}
	></span>
{/snippet}

{#snippet workstreamName(workstream: Workstream, view: WorkstreamView, offset: number)}
	<Tooltip
		content={view.label}
		placement="right"
		{offset}
		onlyWhenTruncated
		suppressed={view.running !== null}
		class="min-w-0 flex-1 truncate"
	>
		<RenameText
			text={view.label}
			shimmer={namedWorkstreamsQuery.data(workstream.id)}
			class="block"
			textClass="block truncate"
		/>
	</Tooltip>
{/snippet}

{#snippet workstreamTrail(view: WorkstreamView)}
	{@const changeTotals = view.changeTotals}
	{#if view.chat.hasDraft}
		<span
			class="text-fg-tertiary shrink-0 group-hover/row:hidden group-has-focus-visible/row:hidden"
			aria-hidden="true"
			data-testid="sidebar-workstream-draft"
		>
			<Icon name="pencil" class="shrink-0" size={14} />
		</span>
	{/if}
	{#if view.chat.queueCount > 0}
		<span
			class="text-3xs text-fg-tertiary shrink-0 font-mono font-medium tabular-nums group-hover/row:hidden group-has-focus-visible/row:hidden"
			data-testid="sidebar-prompt-queue-count"
		>
			{view.chat.queueCount} queued
		</span>
	{:else if changeTotals && (changeTotals.additions > 0 || changeTotals.deletions > 0)}
		<span
			class="text-3xs flex shrink-0 gap-1 font-mono font-medium tabular-nums group-hover/row:hidden group-has-focus-visible/row:hidden"
			aria-label={`${changeTotals.additions} additions, ${changeTotals.deletions} deletions`}
			data-testid="sidebar-workstream-change-totals"
			data-additions={changeTotals.additions}
			data-deletions={changeTotals.deletions}
		>
			{#if changeTotals.additions > 0}<span class="text-success-content">
					+{formatCompactChangeTotal(changeTotals.additions)}
				</span>{/if}
			{#if changeTotals.deletions > 0}<span class="text-error-content">
					−{formatCompactChangeTotal(changeTotals.deletions)}
				</span>{/if}
		</span>
	{:else if changeTotals && changeTotals.files > 0}
		<span
			class="text-3xs text-fg-tertiary shrink-0 font-mono font-medium tabular-nums group-hover/row:hidden group-has-focus-visible/row:hidden"
			data-testid="sidebar-workstream-changed-files"
			data-files={changeTotals.files}
		>
			{formatCompactChangeTotal(changeTotals.files)}
			{changeTotals.files === 1 ? 'file' : 'files'}
		</span>
	{/if}
{/snippet}

{#snippet newWorkstreamButton(repository: Repository, className: string)}
	<Tooltip content={`New workstream for ${repository.fullName}`} placement="top" class="relative">
		<IconButton
			variant="ghost"
			size="sm"
			class={className}
			ariaLabel={`New workstream for ${repository.fullName}`}
			data-testid="sidebar-new-workstream"
			data-navigation-path-id="expected-path:workstream-sidebar.create"
			data-navigation-dynamic-target="true"
			onclick={() => openNewWorkstream(repository)}
		>
			<Icon name="plus" size={14} />
		</IconButton>
	</Tooltip>
{/snippet}

{#snippet archiveButton(workstream: Workstream, view: WorkstreamView, placement: string)}
	<Tooltip
		content={view.lifecycle.tooltip}
		placement="right"
		suppressed={view.running !== null}
		class={placement}
	>
		<IconButton
			variant="ghost"
			size="sm"
			class="pointer-events-none opacity-0 transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-focus-visible/row:pointer-events-auto group-has-focus-visible/row:opacity-100"
			disabled={!onArchiveWorkstream || view.lifecycle.kind === 'blocked'}
			ariaLabel={view.lifecycle.ariaLabel}
			data-testid="sidebar-archive-workstream"
			data-workstream-id={workstream.id}
			data-workstream-lifecycle={view.lifecycle.kind}
			data-navigation-target={workstream.id === activeWorkstreamId ? rowHref(null) : undefined}
			data-navigation-path-id={workstream.id === activeWorkstreamId
				? 'expected-path:workstream-lifecycle.exit-active'
				: undefined}
			data-navigation-outcome-key={workstream.id === activeWorkstreamId &&
			view.lifecycle.archivesNatively
				? 'archived'
				: undefined}
			onclick={(event) => requestArchive(event, workstream)}
		>
			{#if view.lifecycle.kind === 'discard'}
				<Icon name="trash" size={14} />
			{:else}
				<Icon name="archive" size={14} />
			{/if}
		</IconButton>
	</Tooltip>
{/snippet}

{#snippet runningCard(workstream: Workstream, view: WorkstreamView)}
	{#if view.running}
		<WorkstreamRunningCard
			iconClass={statusIconColor(view.state, view.busy, view.pullRequest)}
			label={view.label}
			branch={workstream.branch}
			baseBranch={workstream.baseBranch}
			pullRequestLabel={view.badge.phase === 'none' || view.badge.phase === 'unknown'
				? null
				: view.badge.label}
			working={view.busy}
			stateLabel={view.state.label}
			changeTotals={view.changeTotals}
			running={view.running}
			onopenport={(port) => openRunningPort(workstream.id, view.targetSessionId, port)}
		>
			{#snippet icon()}
				{@render statusGlyph(
					view.loading,
					view.state.tone === 'background',
					view.pullRequest.glyph,
				)}
			{/snippet}
		</WorkstreamRunningCard>
	{/if}
{/snippet}

{#snippet repositoryCard(row: ConnectedRepositoryContext)}
	<div class="flex flex-col gap-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<RepositoryAvatar fullName={row.repo.fullName} size={36} />
			<div class="flex min-w-0 flex-col">
				<span class="text-fg-default truncate text-sm leading-5 font-medium">
					{row.repo.fullName}
				</span>
				<span class="text-fg-tertiary text-xs leading-4">
					{workstreamCountLabel(row.workstreams.length)}
				</span>
			</div>
		</div>
		<div class="border-surface-elevated-border border-t pt-3">
			<ScratchpadIdeasPreview repositoryFullName={row.repo.fullName} />
		</div>
	</div>
{/snippet}

<SidebarFrame testId="repository-sidebar">
	<nav
		class={['min-h-0 flex-1 select-none', reorder && 'cursor-grabbing']}
		aria-label="Connected repositories"
		onclickcapture={swallowDragClick}
		oncontextmenu={openConnectMenu}
	>
		<ScrollableDiv
			class="h-full"
			viewportClass="px-2 pb-3"
			ariaLabel="Connected repositories"
			testId="repository-scroll"
		>
			{#if scopeFailure}
				<StateBlock
					layout="inline"
					live="alert"
					tone={scopeFailure.tone}
					heading={scopeFailure.heading}
					detail={scopeFailure.detail}
					remedy={scopeFailure.remedy}
					technical={scopeFailure.technical}
					testId="repository-scope-error"
				>
					{#snippet icon()}
						<Icon name="plug" size={14} />
					{/snippet}
					{#snippet action()}
						{#if onRetryScope}
							<Button
								variant="secondary"
								size="sm"
								ariaLabel="Retry loading workstream data"
								data-testid="repository-scope-retry"
								onclick={() => onRetryScope?.()}
							>
								<Icon name="refresh" size={13} />
								Retry
							</Button>
						{/if}
					{/snippet}
				</StateBlock>
			{/if}

			{#if scopeLoading}
				<RepositorySidebarSkeleton label="Loading connected repositories" />
			{:else if rows.length === 0 && !scopeFailure}
				<StateBlock
					layout="inline"
					heading={everyRepositoryHidden
						? 'Every repository is hidden'
						: repositories.length > 0
							? 'No workstreams yet'
							: 'No repositories connected'}
					detail={everyRepositoryHidden
						? 'Hidden repositories keep their workstreams.'
						: repositories.length > 0
							? 'Workstreams live here, one group per repository.'
							: 'Connected repositories and their workstreams live here, one group per repository.'}
					remedy={everyRepositoryHidden
						? 'Unhide one from the repository list.'
						: repositories.length > 0
							? 'Start one from the repository list.'
							: 'Connect a repository to start a workstream.'}
					testId="repository-sidebar-empty"
				>
					{#snippet icon()}
						<Icon name="link" size={14} />
					{/snippet}
				</StateBlock>
			{:else if rows.length > 0}
				<ul
					class={[
						'flex w-full flex-col pt-2',
						compact ? 'gap-1' : 'gap-3',
						reorder && 'pointer-events-none',
					]}
				>
					{#each entries as entry (entry.id)}
						{#if entry.kind === 'owner'}
							{@render ownerFolder(entry)}
						{:else}
							{@render repositoryGroup(entry.item, false, entryIds)}
						{/if}
					{/each}
				</ul>
			{/if}
		</ScrollableDiv>
	</nav>

	<WorkstreamContextMenu
		target={contextMenu}
		onclose={closeContextMenu}
		onRemoved={leaveRemovedWorkstream}
		removedNavigationTarget={exitTargetWhenRemoved}
	>
		{#snippet actions({ workstreamId, close }: { workstreamId: string; close: () => void })}
			{@const running = workstreamRunning(workstreamId)}
			{#if running}
				{#each running.items as item (item.id)}
					<DropdownItem
						role="menuitem"
						focusOnHover={false}
						class="gap-2.5"
						onclick={() => {
							stopRunningCommand(workstreamId, [item]);
							close();
						}}
					>
						<Icon name="stop" class="shrink-0" size={15} />
						<span class="min-w-0 truncate">Stop {item.name}</span>
					</DropdownItem>
				{/each}
				<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
			{/if}
		{/snippet}
	</WorkstreamContextMenu>

	<RepositoryContextMenu
		target={repositoryMenu}
		onclose={closeContextMenu}
		onremove={onRemoveRepository}
	/>

	<ConnectRepositoryContextMenu target={connectMenu} onclose={closeContextMenu} />

	<StagedUpdateButton />

	<SidebarArchived />

	<SidebarFooter />
</SidebarFrame>
