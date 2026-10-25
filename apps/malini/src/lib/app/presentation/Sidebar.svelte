<script lang="ts">
	import { afterNavigate, goto } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount, tick } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide, type SlideParams } from 'svelte/transition';
	import { BusyIcon, ChatTileIcon, Icon } from '$hyper-ui/icons';
	import {
		HOME_SCOPE,
		connectedRepositoryContexts,
		hiddenRepositoriesQuery,
		inSidebarOrder,
		leadScopeLabel,
		moveInSidebarCommand,
		sidebarOrderQuery,
		startLeadChatCommand,
		type LeadScope,
		type SidebarMove,
	} from '$shared/repositories/repositories.api';
	import { reorderIndex, reorderShift, settledOffset, type SidebarSlot } from './sidebar-reorder';
	import { collapsedGroupsQuery } from '$lib/app/application/queries/collapsed-groups.query.svelte';
	import { sidebarDensityQuery } from '$lib/app/application/queries/sidebar-density.query.svelte';
	import { sidebarFocusQuery } from '$lib/app/application/queries/sidebar-focus.query.svelte';
	import { sidebarArrangementQuery } from '$lib/app/application/queries/sidebar-arrangement.query.svelte';
	import { sidebarSectionsQuery } from '$lib/app/application/queries/sidebar-sections.query.svelte';
	import {
		DEFAULT_SIDEBAR_ARRANGEMENT,
		sectionedGrouping,
	} from '$lib/app/domain/sidebar-arrangement';
	import { arrangeSidebarCommand } from '$lib/app/application/commands/arrange-sidebar.command';
	import { chooseSidebarFocusCommand } from '$lib/app/application/commands/choose-sidebar-focus.command';
	import { toggleSidebarPinCommand } from '$lib/app/application/commands/toggle-sidebar-pin.command';
	import { toggleGroupCollapsedCommand } from '$lib/app/application/commands/toggle-group-collapsed.command';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { leadHeadline, progressLabel, type ProgressDot } from '$lib/app/domain/lead-progress';
	import { ALL_FOCUS, focusStillExists, type SidebarFocus } from '$lib/app/domain/sidebar-focus';
	import { PROGRESS_DOT_CLASS } from './progress-dot-class';
	import { SECTION_ICONS } from './sidebar-arrangement-icons';
	import {
		branchWorkstreamIds,
		sectionSubgrouping,
		sidebarRepositoryIds,
		sidebarTree,
		sidebarWorkstreamIds,
		type SidebarOwner,
		type SidebarSection,
	} from '$lib/app/domain/sidebar-tree';
	import { WorkstreamRunningLine } from '$lib/stats/stats.api';
	import { watchWorkstreamRunningHook } from '$lib/stats/application/hooks/watch-workstream-running.hook';
	import { workstreamRunningQuery } from '$lib/stats/application/queries/workstream-running.query.svelte';
	import { openBrowserUrlCommand } from '$lib/browser/application/commands/open-browser-url.command';
	import { stopRunningCommand } from '$lib/stats/application/commands/stop-running.command';
	import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import StagedUpdateButton from './StagedUpdateButton.svelte';
	import SidebarFocusStrip, { type FocusChoice } from './SidebarFocusStrip.svelte';
	import { ScratchpadIdeasCount, ScratchpadIdeasPreview } from '$lib/scratchpad/scratchpad.api';
	import { WorkstreamChatSummary } from '$lib/chat/chat.api';
	import {
		archivedWorkstreamsQuery,
		provisioningRecordQuery,
		workstreamCount,
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
	import StartedWorkstreams from './StartedWorkstreams.svelte';
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
		onSaveWorkstreamForLater?: (workstream: Workstream) => void;
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
		onSaveWorkstreamForLater,
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
	const arrangement = $derived(sidebarArrangementQuery.data);
	const manualOrder = $derived(arrangement.ordering === 'manual');
	const sectioned = $derived(sectionedGrouping(arrangement.grouping));
	const dragEnabled = $derived(manualOrder && !sectioned);
	let nowMs = $state(Date.now());
	const sectionOf = $derived(sidebarSectionsQuery.sectionOf(arrangement.grouping, nowMs));
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
	const leads = $derived(
		inSidebarOrder(
			workstreams.filter((workstream) => workstream.scope !== null),
			sidebarOrder.workstreamIds,
		),
	);
	const savedForLaterCounts = $derived(
		archivedWorkstreamsQuery.data.reduce((counts, workstream) => {
			if (!workstream.savedForLater || workstream.repositoryId === null) return counts;
			return counts.set(workstream.repositoryId, (counts.get(workstream.repositoryId) ?? 0) + 1);
		}, new Map<string, number>()),
	);
	const savedRepositoryIds = $derived(new Set(savedForLaterCounts.keys()));
	const contexts = $derived(
		connectedRepositoryContexts({
			repositories,
			workstreams: workstreams.filter((workstream) => workstream.scope === null),
			activeWorkstreamId,
			order: sidebarOrder,
			savedRepositoryIds,
		}),
	);
	const unhiddenRows = $derived(contexts.filter((row) => !hiddenRepositoryIds.has(row.repo.id)));
	const everyRepositoryHidden = $derived(contexts.length > 0 && unhiddenRows.length === 0);
	const ownerChoices = $derived(focusOwners(unhiddenRows, leads));
	const repositoryChoices = $derived(
		unhiddenRows.map((row): FocusChoice => ({
			focus: { kind: 'repository', repositoryId: row.repo.id },
			label: row.name,
			avatarFullName: row.repo.fullName,
		})),
	);
	const focusState = $derived(sidebarFocusQuery.data);
	const presentFocuses = $derived({
		owners: new Set(ownerChoices.map((choice) => choice.label.toLowerCase())),
		repositoryIds: new Set(unhiddenRows.map((row) => row.repo.id)),
	});
	const focus = $derived(
		focusStillExists(focusState.active, presentFocuses) ? focusState.active : ALL_FOCUS,
	);
	const pinnedChoices = $derived(
		focusState.pinned.flatMap((pinned) => {
			const choice = [...ownerChoices, ...repositoryChoices].find(
				(candidate) => focusOwnerKey(candidate.focus) === focusOwnerKey(pinned),
			);
			return choice ? [choice] : [];
		}),
	);
	const tree = $derived(
		sidebarTree({
			contexts,
			leads,
			hiddenRepositoryIds,
			focus,
			arrangement,
			activeAt: sidebarSectionsQuery.activeAt,
			sectionOf,
		}),
	);
	const flatSections = $derived(
		sectioned &&
			focus.kind !== 'repository' &&
			sectionSubgrouping(arrangement.subgrouping, focus) === 'none',
	);
	const repositoryOfWorkstream = $derived(
		new Map(
			contexts.flatMap((context) =>
				context.workstreams.map((workstream) => [workstream.id, context]),
			),
		),
	);
	const blockIds = $derived(tree.blocks.map((block) => block.id));
	const chatIds = $derived(tree.chats.map((chat) => chat.id));
	const repositoryIdsByEntry = $derived(
		new Map(
			tree.blocks.map((block) => [
				block.id,
				block.kind === 'owner'
					? block.repositories.map(({ repo }) => repo.id)
					: [block.repository.repo.id],
			]),
		),
	);
	const listedRepositoryIds = $derived(sidebarRepositoryIds(tree));
	const listedWorkstreamIds = $derived(sidebarWorkstreamIds(tree));
	const hasRows = $derived(
		tree.chats.length > 0 || tree.blocks.length > 0 || tree.sections.length > 0,
	);
	const avatarSize = $derived(compact ? 16 : 20);
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

	$effect(() => {
		if (!sectioned) return;
		nowMs = Date.now();
		const clock = setInterval(() => (nowMs = Date.now()), SECTION_CLOCK_MS);
		return () => clearInterval(clock);
	});

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

	function requestSaveForLater(event: MouseEvent, workstream: Workstream): void {
		event.preventDefault();
		event.stopPropagation();
		onSaveWorkstreamForLater?.(workstream);
	}

	function rowEndPadding(saveable: boolean): string {
		return saveable
			? 'pr-3 group-hover/row:pr-14 group-has-focus-visible/row:pr-14'
			: 'pr-3 group-hover/row:pr-8 group-has-focus-visible/row:pr-8';
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
	const SECTION_CLOCK_MS = 60_000;
	const SETTLE_MS = 150;

	function listedIds(kind: SidebarMove['kind']): readonly string[] {
		return kind === 'repository' ? listedRepositoryIds : listedWorkstreamIds;
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
		if (event.button !== 0 || reorder || settling || !dragEnabled) return;
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
		if (!dragEnabled || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
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

	function attentionColor(chat: ChatSummary): string | null {
		if (!chat.attention || !chat.needsYou) return null;
		return chat.attention.kind === 'failed' ? 'text-error-content' : 'text-warning-content';
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
		label: string,
		chat: ChatSummary,
	): WorkstreamView {
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
		repositoryFullName: string | null,
		view: WorkstreamView,
	): Record<`data-${string}`, string | undefined> {
		return {
			'data-testid': workstream.scope === null ? 'sidebar-workstream' : 'sidebar-chat',
			'data-workstream-id': workstream.id,
			'data-navigation-workstream-id': workstream.id,
			'data-navigation-pending': workstream.id === pendingWorkstreamId ? 'true' : undefined,
			'data-navigation-feedback-only': 'true',
			'data-repository-full-name': repositoryFullName ?? undefined,
			'data-chat-scope': workstream.scope?.kind,
			'data-workstream-state': view.state.tone,
			'data-workstream-checkout': workstream.checkoutState,
			'data-workstream-draft': view.chat.hasDraft ? 'true' : undefined,
		};
	}

	const LEVEL_PADDING = ['pl-2', 'pl-6', 'pl-9'] as const;
	const MAX_PROGRESS_DOTS = 8;

	function moveShortcuts(...more: readonly string[]): string {
		return [...(dragEnabled ? ['Alt+ArrowUp', 'Alt+ArrowDown'] : []), ...more].join(' ');
	}

	function levelPadding(level: number): string {
		return LEVEL_PADDING[Math.min(level, LEVEL_PADDING.length - 1)] ?? 'pl-9';
	}

	type SidebarRow = Readonly<{
		workstream: Workstream;
		repositoryFullName: string | null;
		repositoryName: string | null;
		label: string;
	}>;

	function leadRow(workstream: Workstream): SidebarRow {
		return {
			workstream,
			repositoryFullName: null,
			repositoryName: null,
			label: displayWorkstreamName(workstream),
		};
	}

	function repositoryRow(workstream: Workstream, repositoryFullName: string): SidebarRow {
		return {
			workstream,
			repositoryFullName,
			repositoryName: null,
			label: workstreamLabel(workstream, repositoryFullName),
		};
	}

	function sectionRow(workstream: Workstream): SidebarRow {
		const repository = repositoryOfWorkstream.get(workstream.id);
		if (workstream.scope !== null || !repository) return leadRow(workstream);
		return {
			...repositoryRow(workstream, repository.repo.fullName),
			repositoryName: flatSections ? repository.name : null,
		};
	}

	function scoped(scope: string, id: string): string {
		return scope ? `${scope}/${id}` : id;
	}

	function focusOwners(
		rows: readonly ConnectedRepositoryContext[],
		scopedLeads: readonly Workstream[],
	): FocusChoice[] {
		const owners = new Map<string, FocusChoice>();
		const add = (owner: string): void => {
			const key = owner.toLowerCase();
			if (!owners.has(key)) {
				owners.set(key, {
					focus: { kind: 'owner', owner },
					label: owner,
					avatarFullName: `${owner}/${owner}`,
				});
			}
		};
		for (const row of rows) if (row.owner !== null) add(row.owner);
		for (const lead of scopedLeads) if (lead.scope?.kind === 'owner') add(lead.scope.owner);
		return [...owners.values()];
	}

	function focusOwnerKey(focus: SidebarFocus): string {
		if (focus.kind === 'owner') return `owner:${focus.owner.toLowerCase()}`;
		if (focus.kind === 'repository') return `repository:${focus.repositoryId}`;
		return 'all';
	}

	function focusNeedsYou(target: SidebarFocus): boolean {
		const focused = sidebarTree({
			contexts,
			leads,
			hiddenRepositoryIds,
			focus: target,
			arrangement: DEFAULT_SIDEBAR_ARRANGEMENT,
			activeAt: sidebarSectionsQuery.activeAt,
			sectionOf,
		});
		return sidebarWorkstreamIds(focused).some(
			(workstreamId) => workstreamChatSummaryQuery.data(workstreamId).needsYou,
		);
	}

	function ownerCountLabel(block: SidebarOwner): string {
		const chats = block.leads.length;
		const repositories = repositoryCountLabel(block.repositories.length);
		if (chats === 0) return repositories;
		const chatLabel = `${chats} ${chats === 1 ? 'chat' : 'chats'}`;
		return block.repositories.length === 0 ? chatLabel : `${chatLabel}, ${repositories}`;
	}

	function scopeOf(block: SidebarOwner): LeadScope {
		return { kind: 'owner', owner: block.owner };
	}
</script>

{#snippet statusGlyph(loading: boolean, background: boolean, glyph: PullRequestVisual['glyph'])}
	{#if loading}
		<BusyIcon size={14} {background} />
	{:else}
		<Icon name={glyph} size={14} />
	{/if}
{/snippet}

{#snippet sectionBlock(section: SidebarSection)}
	{@const collapseId = `section:${section.key}`}
	{@const collapsed = collapsedGroupIds.has(collapseId)}
	{@const icon = SECTION_ICONS[section.key]}
	{@const count = branchWorkstreamIds(section).length}
	{@const chatIds = section.chats.map((chat) => chat.id)}
	{@const blockIds = section.blocks.map((block) => block.id)}
	<li class="relative w-full min-w-0" data-testid="sidebar-section" data-section={section.key}>
		<Button
			bare
			class={[
				'text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 font-medium outline-none',
				compact ? 'text-2xs h-6' : 'h-7 text-xs',
			]}
			ariaLabel={`${section.label}, ${workstreamCountLabel(count)}`}
			ariaExpanded={!collapsed}
			ariaControls={`section-rows-${section.key}`}
			data-testid="sidebar-section-header"
			onclick={() => toggleGroupCollapsedCommand(collapseId)}
		>
			{#if icon}
				<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
					<Icon name={icon.name} size={14} class={icon.tone} />
				</span>
			{/if}
			<span class="min-w-0 truncate text-left">{section.label}</span>
			<span class="text-3xs text-fg-quaternary shrink-0 font-mono tabular-nums">{count}</span>
			<span class="grow"></span>
			<Icon
				name="chevron-down"
				class={`text-fg-tertiary shrink-0 transition-transform duration-100 ${collapsed ? '-rotate-90' : ''}`}
				size={13}
			/>
		</Button>
		<div
			id={`section-rows-${section.key}`}
			class={['flex w-full flex-col', compact ? 'gap-0.5' : 'gap-1.5', collapsed && 'hidden']}
		>
			{#if section.chats.length > 0}
				<ul class="flex w-full flex-col" aria-label={section.label}>
					{#each section.chats as chat (chat.id)}
						{@render workstreamItem(sectionRow(chat), 0, chatIds)}
					{/each}
				</ul>
			{/if}
			{#if section.blocks.length > 0}
				<ul class={['flex w-full flex-col', compact ? 'gap-0.5' : 'gap-1.5']}>
					{#each section.blocks as block (block.id)}
						{#if block.kind === 'owner'}
							{@render ownerBlock(block, false, section.key)}
						{:else}
							{@render repositoryGroup(block.repository, 0, blockIds, section.key)}
						{/if}
					{/each}
				</ul>
			{/if}
		</div>
	</li>
{/snippet}

{#snippet ownerBlock(block: SidebarOwner, focused: boolean, scope: string)}
	{@const collapseId = scoped(scope, block.id)}
	{@const collapsed = !focused && collapsedGroupIds.has(collapseId)}
	{@const leadIds = block.leads.map((lead) => lead.id)}
	{@const repositoryIds = block.repositories.map(({ repo }) => repo.id)}
	<li
		class={['relative w-full min-w-0', reorderClass(block.id)]}
		style:transform={reorderTransform(block.id)}
		data-sidebar-item={focused ? undefined : block.id}
		onpointerdown={(event) => {
			if (!focused) armReorder(event, { kind: 'repository', id: block.id });
		}}
	>
		<div class="group/owner relative">
			{#if focused}
				<div
					class={[
						'text-fg-default flex w-full items-center gap-2 rounded-xl pr-9 pl-2',
						compact ? 'h-7 text-xs' : 'h-8 text-sm',
					]}
					data-testid="sidebar-owner-folder"
					data-owner={block.owner}
				>
					<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
						<RepositoryAvatar fullName={`${block.owner}/${block.owner}`} size={avatarSize} />
					</span>
					<h2 class="min-w-0 flex-1 truncate leading-relaxed font-medium">{block.owner}</h2>
				</div>
			{:else}
				<Button
					bare
					class={[
						'text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 outline-none',
						compact ? 'h-7 text-xs' : 'h-8 text-sm',
					]}
					ariaLabel={`${block.owner}, ${ownerCountLabel(block)}`}
					ariaExpanded={!collapsed}
					ariaControls={`owner-repositories-${collapseId}`}
					{...dragEnabled ? { ariaKeyshortcuts: moveShortcuts() } : {}}
					data-sidebar-grip=""
					data-testid="sidebar-owner-folder"
					data-owner={block.owner}
					onclick={() => toggleGroupCollapsedCommand(collapseId)}
					onkeydown={(event) => void onMoveKey(event, 'repository', block.id, blockIds)}
				>
					<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
						<RepositoryAvatar fullName={`${block.owner}/${block.owner}`} size={avatarSize} />
					</span>
					<span class="min-w-0 flex-1 truncate text-left leading-relaxed font-medium">
						{block.owner}
					</span>
					<span
						class="text-3xs text-fg-tertiary shrink-0 font-mono font-medium tabular-nums group-hover/owner:invisible group-has-focus-visible/owner:invisible"
					>
						{block.leads.length + block.repositories.length}
					</span>
					<Icon
						name="chevron-down"
						class={`text-fg-tertiary shrink-0 transition-transform duration-100 ${collapsed ? '-rotate-90' : ''}`}
						size={13}
					/>
				</Button>
			{/if}
			<span
				class={[
					'absolute top-1/2 -translate-y-1/2',
					focused
						? 'right-1'
						: 'pointer-events-none right-6 opacity-0 group-hover/owner:pointer-events-auto group-hover/owner:opacity-100 group-has-focus-visible/owner:pointer-events-auto group-has-focus-visible/owner:opacity-100',
				]}
			>
				{@render newChatButton(scopeOf(block))}
			</span>
		</div>
		<div
			id={`owner-repositories-${collapseId}`}
			class={['flex w-full flex-col gap-0.5', collapsed && 'hidden']}
		>
			{#if block.leads.length > 0}
				<ul class="flex w-full flex-col" aria-label={`Chats in ${block.owner}`}>
					{#each block.leads as lead (lead.id)}
						{@render workstreamItem(leadRow(lead), 1, leadIds)}
					{/each}
				</ul>
			{/if}
			{#if block.repositories.length > 0}
				<ul class="flex w-full flex-col gap-0.5">
					{#each block.repositories as repository (repository.repo.id)}
						{@render repositoryGroup(repository, 1, repositoryIds, scope)}
					{/each}
				</ul>
			{/if}
		</div>
	</li>
{/snippet}

{#snippet repositoryGroup(
	row: ConnectedRepositoryContext,
	level: number,
	siblingIds: readonly string[],
	scope: string,
)}
	{@const nested = level > 0}
	{@const collapseId = scoped(scope, row.repo.id)}
	{@const collapsed = collapsedGroupIds.has(collapseId)}
	{@const workstreamIds = row.workstreams.map((workstream) => workstream.id)}
	{@const savedForLater = savedForLaterCounts.get(row.repo.id) ?? 0}
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
						levelPadding(level),
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
								onclick={() => toggleGroupCollapsedCommand(collapseId)}
								ariaLabel={`${collapsed ? 'Expand' : 'Collapse'} ${row.repo.fullName}`}
								ariaExpanded={!collapsed}
								ariaControls={`repository-workstreams-${collapseId}`}
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
						aria-describedby={`repository-saved-${collapseId} repository-notes-${collapseId}`}
						aria-current={row.repo.id === openRepositoryId ? 'page' : undefined}
						class="hover:text-fg-default focus-visible:text-fg-default min-w-0 flex-1 outline-none before:absolute before:inset-0 before:content-['']"
						aria-keyshortcuts={moveShortcuts('Shift+F10')}
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
					{#if savedForLater > 0}
						<span
							class="text-3xs text-fg-tertiary flex shrink-0 items-center gap-1 font-mono font-medium tabular-nums"
							aria-hidden="true"
							data-testid="sidebar-saved-for-later-count"
						>
							<Icon name="clock" size={12} />
							{savedForLater}
						</span>
						<span id={`repository-saved-${collapseId}`} class="sr-only">
							{workstreamCount(savedForLater)} saved for later
						</span>
					{/if}
					<ScratchpadIdeasCount
						repositoryFullName={row.repo.fullName}
						descriptionId={`repository-notes-${collapseId}`}
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
			id={`repository-workstreams-${collapseId}`}
			class={['flex w-full flex-col', collapsed && 'hidden']}
		>
			{#each row.workstreams as workstream (workstream.id)}
				{@render workstreamItem(
					repositoryRow(workstream, row.repo.fullName),
					level + 1,
					workstreamIds,
				)}
			{/each}
		</ul>
	</li>
{/snippet}

{#snippet workstreamItem(row: SidebarRow, level: number, siblingIds: readonly string[])}
	{@const workstream = row.workstream}
	{@const isLead = workstream.scope !== null}
	{@const dots = leadProgressQuery.dots(workstream.id)}
	<li
		class={['relative mt-0.5 w-full min-w-0', reorderClass(workstream.id)]}
		style:transform={reorderTransform(workstream.id)}
		data-sidebar-item={workstream.id}
		onpointerdown={(event) => armReorder(event, { kind: 'workstream', id: workstream.id })}
		transition:slide={foldMotion()}
	>
		<div class="group/row relative w-full min-w-0">
			<WorkstreamChatSummary workstreamId={workstream.id}>
				{#snippet children(chat)}
					{@const view = workstreamView(workstream, row.label, chat)}
					{@const saveable =
						!isLead && view.lifecycle.kind === 'archive' && onSaveWorkstreamForLater !== undefined}
					{#snippet card()}
						{@render runningCard(workstream, view)}
					{/snippet}
					{#snippet rowLink()}
						<Tooltip
							content={card}
							interactive
							placement="right"
							suppressed={!view.running || dots.length > 0}
							class="w-full min-w-0"
						>
							<a
								draggable="false"
								href={rowHref(workstream.id, view.targetSessionId)}
								data-navigation-path-id="expected-path:workstream-sidebar.switch"
								aria-current={workstream.id === activeWorkstreamId ? 'page' : undefined}
								aria-busy={workstream.id === pendingWorkstreamId || undefined}
								class={[
									'sidebar-row relative w-full flex-col items-stretch outline-none',
									rowEndPadding(saveable),
									levelPadding(level),
									compact && 'py-1 text-xs',
									view.chat.attention !== null
										? 'text-500'
										: 'text-fg-tertiary group-hover/row:text-fg-secondary focus-visible:text-fg-secondary data-[active=true]:text-fg-secondary',
									view.selected
										? 'sidebar-row-active'
										: 'group-hover/row:bg-surface-50-hover focus-visible:bg-surface-50-hover data-[active=true]:bg-surface-50-hover',
								]}
								data-active={workstream.id === contextMenu?.workstreamId}
								{...workstreamLinkData(workstream, row.repositoryFullName, view)}
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
								aria-keyshortcuts={moveShortcuts('Shift+F10')}
								onkeydown={(event) => {
									if (opensMenu(event)) {
										openWorkstreamMenu(event, workstream.id);
										return;
									}
									previewDestinationFromKeyboard(event, workstream.id, view.targetSessionId);
									void onMoveKey(event, 'workstream', workstream.id, siblingIds);
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
									{#if isLead}
										{@render chatGlyph(view, level)}
									{:else}
										{@render statusIndicator(view, level)}
									{/if}
									<span class="sidebar-row-text gap-1.5">
										{@render workstreamName(workstream, view)}
										{#if row.repositoryName}
											<span
												class="text-2xs text-fg-quaternary max-w-24 shrink-0 truncate"
												data-testid="sidebar-row-repository"
											>
												{row.repositoryName}
											</span>
										{/if}
										{#if dots.length > 0}
											{@render progress(dots)}
										{:else}
											{@render workstreamTrail(view)}
										{/if}
									</span>
								</span>
								{#if view.running}
									<span class="pl-6" transition:slide={foldMotion()}>
										<WorkstreamRunningLine running={view.running} selected={view.selected} />
									</span>
								{/if}
							</a>
							{#if saveable}
								{@render saveForLaterButton(
									workstream,
									view,
									[
										'absolute h-lh items-center leading-relaxed',
										'right-7',
										compact ? 'top-1 text-xs' : 'top-1.5 text-sm',
									].join(' '),
								)}
							{/if}
							{@render archiveButton(
								workstream,
								view,
								[
									'absolute h-lh items-center leading-relaxed',
									'right-1',
									compact ? 'top-1 text-xs' : 'top-1.5 text-sm',
								].join(' '),
							)}
						</Tooltip>
					{/snippet}
					{#if dots.length > 0}
						<HoverCard
							side="right"
							align="start"
							sideOffset={12}
							openDelay={500}
							triggerPress="dismiss"
							triggerClass="w-full min-w-0"
							panelClass="w-88 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
							testId="sidebar-started-card"
						>
							{#snippet trigger()}
								{@render rowLink()}
							{/snippet}
							{#snippet content()}
								{@render startedCard(workstream, view, dots)}
							{/snippet}
						</HoverCard>
					{:else}
						{@render rowLink()}
					{/if}
				{/snippet}
			</WorkstreamChatSummary>
		</div>
	</li>
{/snippet}

{#snippet chatGlyph(view: WorkstreamView, level: number)}
	<Tooltip
		content={visualStateTooltip(view.state, view.chat, view.pullRequest)}
		placement="right"
		suppressed={view.running !== null}
		class="relative z-10 shrink-0"
	>
		<span
			class={[
				'grid shrink-0 place-items-center',
				level === 0 ? 'h-5 w-5' : 'h-4 w-4',
				attentionColor(view.chat),
			]}
			role="status"
			aria-label={`Chat status: ${visualStateTooltip(view.state, view.chat, view.pullRequest)}`}
			style:--chat-tile-color={attentionColor(view.chat) ? 'currentColor' : undefined}
			data-testid="sidebar-chat-status"
			data-workstream-icon-state={view.state.tone}
			data-attention-kind={view.chat.needsYou ? view.chat.attention?.kind : undefined}
		>
			{#if view.busy}
				<BusyIcon size={14} background={view.state.tone === 'background'} />
			{:else}
				<ChatTileIcon size={16} />
			{/if}
		</span>
	</Tooltip>
{/snippet}

{#snippet progress(dots: readonly ProgressDot[])}
	{@const shown = dots.slice(0, MAX_PROGRESS_DOTS)}
	<span
		class="flex shrink-0 items-center gap-[3px]"
		role="img"
		aria-label={progressLabel(dots)}
		data-testid="sidebar-progress"
	>
		{#each shown as dot, index (index)}
			<span
				class={['h-1.5 w-1.5 rounded-full', PROGRESS_DOT_CLASS[dot]]}
				data-progress-dot={dot}
			></span>
		{/each}
		{#if dots.length > shown.length}
			<span class="text-3xs text-fg-tertiary font-mono font-medium tabular-nums">
				+{dots.length - shown.length}
			</span>
		{/if}
	</span>
{/snippet}

{#snippet newChatRow()}
	<Button
		bare
		class={[
			'text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default focus-visible:bg-surface-50-hover focus-visible:text-fg-default flex w-full cursor-pointer items-center gap-2 rounded-xl pr-2 pl-2 outline-none',
			compact ? 'h-7 text-xs' : 'h-8 text-sm',
		]}
		ariaLabel="New chat"
		data-testid="sidebar-new-home-chat"
		onclick={() => startLeadChatCommand(HOME_SCOPE)}
	>
		<span class="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
			<Icon name="plus" size={15} />
		</span>
		<span class="min-w-0 flex-1 truncate text-left leading-relaxed">New chat</span>
	</Button>
{/snippet}

{#snippet newChatButton(scope: LeadScope)}
	<Tooltip content={`New chat in ${leadScopeLabel(scope)}`} placement="top" class="relative">
		<IconButton
			variant="ghost"
			size="sm"
			ariaLabel={`New chat in ${leadScopeLabel(scope)}`}
			data-testid="sidebar-new-chat"
			onclick={(event) => {
				event.stopPropagation();
				startLeadChatCommand(scope);
			}}
		>
			<Icon name="plus" size={14} />
		</IconButton>
	</Tooltip>
{/snippet}

{#snippet statusIndicator(view: WorkstreamView, level: number)}
	<Tooltip
		content={visualStateTooltip(view.state, view.chat, view.pullRequest)}
		placement="right"
		suppressed={view.running !== null}
		class="relative z-10 shrink-0"
	>
		<span
			class={[
				'grid place-items-center',
				level === 0 ? 'h-5 w-5' : 'h-4 w-4',
				attentionColor(view.chat) ?? statusIconColor(view.state, view.busy, view.pullRequest),
			]}
			role="status"
			aria-label={`Workstream status: ${visualStateTooltip(view.state, view.chat, view.pullRequest)}`}
			data-testid={view.state.tone === 'running' || view.state.tone === 'background'
				? 'sidebar-workstream-loader'
				: 'sidebar-workstream-status'}
			data-workstream-icon-state={view.state.tone}
			data-workstream-pull-request-state={view.badge.phase}
			data-attention-kind={view.chat.needsYou ? view.chat.attention?.kind : undefined}
		>
			{@render statusGlyph(view.loading, view.state.tone === 'background', view.pullRequest.glyph)}
		</span>
	</Tooltip>
{/snippet}

{#snippet workstreamName(workstream: Workstream, view: WorkstreamView)}
	<Tooltip
		content={view.label}
		placement="right"
		offset={40}
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

{#snippet saveForLaterButton(workstream: Workstream, view: WorkstreamView, placement: string)}
	<Tooltip
		content="Save for later"
		placement="right"
		suppressed={view.running !== null}
		class={placement}
	>
		<IconButton
			variant="ghost"
			size="sm"
			class="pointer-events-none opacity-0 transition-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-has-focus-visible/row:pointer-events-auto group-has-focus-visible/row:opacity-100"
			ariaLabel={`Save ${view.label} for later`}
			data-testid="sidebar-save-workstream-for-later"
			data-workstream-id={workstream.id}
			onclick={(event) => requestSaveForLater(event, workstream)}
		>
			<Icon name="clock" size={14} />
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

{#snippet startedCard(workstream: Workstream, view: WorkstreamView, dots: readonly ProgressDot[])}
	{@const headline = leadHeadline(dots)}
	<div class="flex flex-col gap-1.5">
		{#if view.running}
			<div class="border-surface-elevated-border border-b px-1.5 pt-1 pb-2.5">
				{@render runningCard(workstream, view)}
			</div>
		{/if}
		<div class="flex min-w-0 flex-col gap-0.5 px-2 pt-1">
			<span class="text-fg-default truncate text-sm font-medium">{view.label}</span>
			<span class="text-fg-tertiary text-xs">
				{headline.label}{#if headline.detail}
					· {headline.detail}{/if}
			</span>
		</div>
		<div class="max-h-96 overflow-y-auto">
			<StartedWorkstreams
				workstreamIds={leadProgressQuery.startedIds(workstream.id)}
				framed={false}
				label={`Started by ${view.label}`}
			/>
		</div>
	</div>
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
	{#snippet lead()}
		<SidebarFocusStrip
			active={focus}
			pinned={pinnedChoices}
			owners={ownerChoices}
			repositories={repositoryChoices}
			attention={focusNeedsYou}
			{arrangement}
			onchoose={chooseSidebarFocusCommand}
			ontogglepin={toggleSidebarPinCommand}
			onarrange={arrangeSidebarCommand}
		/>
	{/snippet}
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
			{:else}
				<ul
					class={[
						'flex w-full flex-col pt-1',
						compact ? 'gap-1' : 'gap-3',
						reorder && 'pointer-events-none',
					]}
				>
					{#if focus.kind === 'all'}
						<li class="relative w-full min-w-0">
							<ul class="flex w-full flex-col" aria-label="Chats">
								<li class="w-full min-w-0">{@render newChatRow()}</li>
								{#each tree.chats as chat (chat.id)}
									{@render workstreamItem(leadRow(chat), 0, chatIds)}
								{/each}
							</ul>
						</li>
					{/if}
					{#each tree.blocks as block (block.id)}
						{#if block.kind === 'owner'}
							{@render ownerBlock(block, focus.kind === 'owner', '')}
						{:else}
							{@render repositoryGroup(block.repository, 0, blockIds, '')}
						{/if}
					{/each}
					{#each tree.sections as section (section.key)}
						{@render sectionBlock(section)}
					{/each}
				</ul>
				{#if !hasRows && focus.kind === 'all' && !scopeFailure}
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
							<Icon name="folder-open" size={14} />
						{/snippet}
					</StateBlock>
				{/if}
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
