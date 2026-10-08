<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { afterNavigate } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount } from 'svelte';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { connectedRepositoryContexts } from '$shared/repositories/repositories.api';
	import { RoutinesNavBadge } from '$lib/routines/routines.api';
	import { WorkstreamChatSummary } from '$lib/chat/chat.api';
	import {
		provisioningRecordQuery,
		workstreamNativeExistenceQuery,
		type WorkstreamChangeTotals,
		type WorkstreamProvisioningRecord,
	} from '$shared/repositories/repositories.api';
	import { displayWorkstreamName, workstreamCount } from '$shared/repositories/repositories.api';
	import type { PullRequestState } from '$lib/pull-requests/application/queries/pull-request-states.query.svelte';
	import { formatCompactChangeTotal } from '$lib/pull-requests/pull-requests.api';
	import type { Repository } from '$shared/repositories/repositories.api';
	import type { Workstream } from '$shared/repositories/repositories.api';
	import { isWorkstreamCheckoutUsable } from '$shared/repositories/repositories.api';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { runtimeDiagnostics } from '$shared/performance/runtime-diagnostics.svelte';
	import SidebarFrame from './SidebarFrame.svelte';
	import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { RepositorySidebarSkeleton } from '$shared/repositories/repositories.api';
	import { describeFailure } from '$shared/errors/failure-copy';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';

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
		pullRequestStateByWorkstream?: Readonly<Record<string, PullRequestState>>;
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
		pullRequestStateByWorkstream = {},
	}: Props = $props();
	const provisioningRecord = $derived(provisioningRecordQuery.data);
	const nativeExistence = $derived(workstreamNativeExistenceQuery.data);
	const scopeFailure = $derived(
		scopeError ? describeFailure(scopeError, { subject: 'Workstream data' }) : null,
	);
	let collapsedRepositoryIds = $state<Set<string>>(new Set());
	let armedRemovalKey = $state<string | null>(null);
	let optimisticDestination = $state<{
		target: string;
		workstreamId: string | null;
	} | null>(null);
	let activeNavigationHandle: ReturnType<typeof runtimeDiagnostics.beginNavigation> | null = null;
	let activeNavigationTarget: string | null = null;
	let previewCleanupTimer: ReturnType<typeof setTimeout> | null = null;

	const rows = $derived(
		connectedRepositoryContexts({
			repositories,
			workstreams,
			activeWorkstreamId,
		}),
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

	function requestArchive(event: MouseEvent, workstream: Workstream): void {
		event.preventDefault();
		event.stopPropagation();
		onArchiveWorkstream?.(workstream);
	}

	$effect(() => {
		if (!armedRemovalKey) return;
		return disarmOnDismiss(() => (armedRemovalKey = null));
	});

	type RepositoryRemoval = Readonly<{
		armed: boolean;
		blocked: boolean;
		label: string;
		ariaLabel: string;
		tooltip: string;
	}>;

	function removalKey(repo: Repository, repoWorkstreams: readonly Workstream[]): string {
		return `${repo.id}:${repoWorkstreams.length}`;
	}

	function repositoryRemoval(
		repo: Repository,
		repoWorkstreams: readonly Workstream[],
	): RepositoryRemoval {
		const blocked = repoWorkstreams.some(
			(workstream) => nativeExistence(workstream.id) === 'in-flight',
		);
		const count = repoWorkstreams.length;
		const archives = workstreamCount(count);
		if (armedRemovalKey !== removalKey(repo, repoWorkstreams)) {
			return {
				armed: false,
				blocked,
				label: '',
				ariaLabel: `Remove ${repo.fullName}`,
				tooltip: blocked
					? 'Still setting up a workstream. Remove the repository once setup finishes or fails.'
					: 'Remove repository',
			};
		}
		if (count === 0) {
			return {
				armed: true,
				blocked,
				label: 'Confirm remove',
				ariaLabel: `Confirm remove ${repo.fullName}`,
				tooltip: `Removes ${repo.fullName}. Escape cancels it`,
			};
		}
		return {
			armed: true,
			blocked,
			label: `Archive ${count} and remove`,
			ariaLabel: `Archive ${archives} and remove ${repo.fullName}`,
			tooltip: `Archives ${archives} with their work saved, then removes ${repo.fullName}. Escape cancels it`,
		};
	}

	function requestRemoval(repo: Repository, repoWorkstreams: readonly Workstream[]): void {
		const key = removalKey(repo, repoWorkstreams);
		if (armedRemovalKey !== key) {
			armedRemovalKey = key;
			return;
		}
		armedRemovalKey = null;
		onRemoveRepository?.(repo, repoWorkstreams);
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

	function toggleRepository(repositoryId: string): void {
		const next = new Set(collapsedRepositoryIds);
		if (next.has(repositoryId)) {
			next.delete(repositoryId);
		} else {
			next.add(repositoryId);
		}
		collapsedRepositoryIds = next;
	}

	type WorkstreamVisualState = {
		label: string;
		icon: string;
		tone:
			| 'idle'
			| 'provisioning'
			| 'running'
			| 'waiting'
			| 'completed'
			| 'failed'
			| 'queued'
			| 'draft'
			| 'broken';
	};

	type ChatTone = 'running' | 'waiting' | 'queued' | 'failed' | 'completed' | 'draft';

	type ChatAttention = Readonly<{ kind: 'completed' | 'failed' | 'approval' }>;

	type ChatSummary = Readonly<{
		sessionId: string | null;
		queueCount: number;
		attention: ChatAttention | null;
		hasDraft: boolean;
		state: Readonly<{ label: string; tone: ChatTone }> | null;
	}>;

	const CHAT_TONE_ICON: Readonly<Record<ChatTone, string>> = {
		running: 'text-fg-secondary',
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
		glyph: 'branch' | 'pr-draft' | 'pr-open' | 'pr-merged' | 'pr-failed';
		color: string;
		label: string | null;
	}>;

	function pullRequestVisual(state: PullRequestState): PullRequestVisual {
		switch (state) {
			case 'draft':
				return { glyph: 'pr-draft', color: '', label: 'Draft pull request' };
			case 'open':
				return { glyph: 'pr-open', color: '', label: 'Pull request open' };
			case 'ready':
				return { glyph: 'pr-open', color: 'text-success-content', label: 'Ready to merge' };
			case 'merged':
				return { glyph: 'pr-merged', color: 'text-merged-content', label: 'Merged' };
			case 'failing':
				return { glyph: 'pr-failed', color: 'text-error-content', label: 'Checks failing' };
			case 'closed':
				return { glyph: 'branch', color: '', label: 'Pull request closed' };
			case 'none':
				return { glyph: 'branch', color: '', label: 'No pull request' };
			default:
				return { glyph: 'branch', color: '', label: null };
		}
	}

	function attentionLabel(attention: ChatAttention): string {
		if (attention.kind === 'failed') return 'Agent run needs attention';
		if (attention.kind === 'approval') return 'Agent is waiting for approval';
		return 'Agent run completed';
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
			chat.attention ? attentionLabel(chat.attention) : null,
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<SidebarFrame testId="repository-sidebar">
	<nav class="min-h-0 flex-1" aria-label="Connected repositories">
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

			{#if rows.length === 0 && scopeLoading}
				<RepositorySidebarSkeleton label="Loading connected repositories" />
			{:else if rows.length === 0 && !scopeFailure}
				<StateBlock
					layout="inline"
					heading={repositories.length > 0 ? 'No workstreams yet' : 'No repositories connected'}
					detail={repositories.length > 0
						? 'Workstreams live here, one group per repository.'
						: 'Connected repositories and their workstreams live here, one group per repository.'}
					remedy={repositories.length > 0
						? 'Start one from the repository list.'
						: 'Connect a repository to start a workstream.'}
					testId="repository-sidebar-empty"
				>
					{#snippet icon()}
						<Icon name="link" size={14} />
					{/snippet}
				</StateBlock>
			{:else if rows.length > 0}
				<ul class="flex w-full flex-col gap-3 pt-2">
					{#each rows as row (row.repo.id)}
						{@const collapsed = collapsedRepositoryIds.has(row.repo.id)}
						{@const removal = repositoryRemoval(row.repo, row.workstreams)}
						<li class="w-full min-w-0">
							<div
								class="group/repo text-fg-secondary flex h-8 w-full items-center gap-2 rounded-xl pr-1 pl-2"
								data-testid="sidebar-connected-repository"
								data-full-name={row.repo.fullName}
								data-workstream-count={row.workstreams.length}
							>
								<div class="relative h-5 w-5 shrink-0">
									<span
										class="absolute inset-0 grid place-items-center group-focus-within/repo:opacity-0 group-hover/repo:opacity-0"
										aria-hidden="true"
										data-testid="sidebar-repository-icon"
									>
										<RepositoryAvatar fullName={row.repo.fullName} size={20} />
									</span>
									<Tooltip
										content={`${collapsed ? 'Expand' : 'Collapse'} ${row.repo.fullName}`}
										placement="right"
										class="absolute inset-0"
									>
										<IconButton
											bare
											onclick={() => toggleRepository(row.repo.id)}
											ariaLabel={`${collapsed ? 'Expand' : 'Collapse'} ${row.repo.fullName}`}
											ariaExpanded={!collapsed}
											ariaControls={`repository-workstreams-${row.repo.id}`}
											class="text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-default focus-visible:ring-border-default/50 pointer-events-none grid h-5 w-5 cursor-pointer place-items-center rounded opacity-0 group-focus-within/repo:pointer-events-auto group-focus-within/repo:opacity-100 group-hover/repo:pointer-events-auto group-hover/repo:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
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
									href={rowHref(row.targetWorkstream?.id)}
									data-navigation-path-id="expected-path:workstream-sidebar.repository"
									aria-label={`Open ${row.repo.fullName}`}
									class="hover:text-fg-default focus-visible:text-fg-default min-w-0 flex-1 outline-none"
									onpointerdown={(event) =>
										previewDestinationFromPointer(event, row.targetWorkstream?.id)}
									onpointerup={() =>
										scheduleAbandonedDestinationPreviewCleanup(rowHref(row.targetWorkstream?.id))}
									onpointercancel={() =>
										abandonDestinationPreview(rowHref(row.targetWorkstream?.id))}
									onpointerleave={() =>
										abandonDestinationPreview(rowHref(row.targetWorkstream?.id))}
									onkeydown={(event) =>
										previewDestinationFromKeyboard(event, row.targetWorkstream?.id)}
									onkeyup={(event) =>
										scheduleKeyboardDestinationPreviewCleanup(
											event,
											rowHref(row.targetWorkstream?.id),
										)}
									onblur={() =>
										scheduleAbandonedDestinationPreviewCleanup(rowHref(row.targetWorkstream?.id))}
									ondragstart={() => abandonDestinationPreview(rowHref(row.targetWorkstream?.id))}
									onclick={(event) =>
										beginWorkstreamNavigation(event, row.targetWorkstream?.id, row.repo.fullName)}
								>
									<span
										class="text-fg-secondary block truncate text-sm leading-relaxed font-medium"
									>
										{row.name}
									</span>
								</a>
								<Tooltip content={removal.tooltip} placement="right">
									<Button
										variant={removal.armed ? 'danger' : 'ghost'}
										size="sm"
										iconOnly={!removal.armed}
										class={[
											!removal.armed &&
												'pointer-events-none opacity-0 transition-none group-focus-within/repo:pointer-events-auto group-focus-within/repo:opacity-100 group-hover/repo:pointer-events-auto group-hover/repo:opacity-100',
										]}
										disabled={!onRemoveRepository || removal.blocked}
										ariaLabel={removal.ariaLabel}
										data-armed={removal.armed ? '' : undefined}
										data-testid="sidebar-remove-repository"
										onclick={() => requestRemoval(row.repo, row.workstreams)}
									>
										{#if removal.armed}
											{removal.label}
										{:else}
											<Icon name="trash" size={14} />
										{/if}
									</Button>
								</Tooltip>
								<Tooltip content={`New workstream for ${row.repo.fullName}`} placement="right">
									<IconButton
										variant="ghost"
										size="sm"
										ariaLabel={`New workstream for ${row.repo.fullName}`}
										data-testid="sidebar-new-workstream"
										data-navigation-path-id="expected-path:workstream-sidebar.create"
										data-navigation-dynamic-target="true"
										onclick={() => openNewWorkstream(row.repo)}
									>
										<Icon name="plus" size={14} />
									</IconButton>
								</Tooltip>
							</div>
							<ul
								id={`repository-workstreams-${row.repo.id}`}
								class={['mt-0.5 flex w-full flex-col gap-0.5', collapsed && 'hidden']}
							>
								{#if row.workstreams.length === 0}
									<li class="w-full min-w-0">
										<Button
											bare
											class="sidebar-row text-fg-tertiary hover:text-fg-secondary focus-visible:bg-surface-50-hover focus-visible:ring-border-default/50 w-full gap-2 pr-3 pl-6 text-left focus-visible:ring-2 focus-visible:outline-none"
											ariaLabel={`Start a workstream in ${row.repo.fullName}`}
											data-testid="sidebar-repository-no-workstreams"
											data-navigation-path-id="expected-path:workstream-sidebar.create"
											data-navigation-dynamic-target="true"
											onclick={() => openNewWorkstream(row.repo)}
										>
											<span class="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
												<Icon name="plus" size={15} />
											</span>
											<span class="sidebar-row-text min-w-0 flex-1 truncate">
												Start a workstream
											</span>
										</Button>
									</li>
								{/if}
								{#each row.workstreams as workstream (workstream.id)}
									<WorkstreamChatSummary workstreamId={workstream.id}>
										{#snippet children(chat)}
											{@const label = workstreamLabel(workstream, row.repo.fullName)}
											{@const queueCount = chat.queueCount}
											{@const attention = chat.attention}
											{@const hasDraft = chat.hasDraft}
											{@const state = visualState(
												workstream,
												provisioningRecord(workstream.id),
												chat,
											)}
											{@const lifecycle = lifecycleAction(workstream.id, label)}
											{@const targetSessionId = chat.sessionId}
											{@const pullRequestState =
												pullRequestStateByWorkstream[workstream.id] ?? 'unknown'}
											{@const changeTotals =
												pullRequestState === 'merged'
													? undefined
													: changeTotalsByWorkstream[workstream.id]}
											{@const pullRequest = pullRequestVisual(pullRequestState)}
											{@const busy = state.tone === 'running' || state.tone === 'provisioning'}
											{@const isSelected = workstream.id === visuallyActiveWorkstreamId}
											<li class="group/row relative w-full min-w-0">
												<a
													href={rowHref(workstream.id, targetSessionId)}
													data-navigation-path-id="expected-path:workstream-sidebar.switch"
													aria-current={workstream.id === activeWorkstreamId ? 'page' : undefined}
													aria-busy={workstream.id === pendingWorkstreamId || undefined}
													class={[
														'sidebar-row relative w-full gap-2 pr-3 pl-6 outline-none',
														isSelected
															? 'sidebar-row-active'
															: [
																	'group-hover/row:bg-surface-50-hover group-hover/row:text-500',
																	'text-fg-secondary focus-visible:bg-surface-50-hover focus-visible:text-500',
																],
													]}
													data-testid="sidebar-workstream"
													data-workstream-id={workstream.id}
													data-navigation-workstream-id={workstream.id}
													data-navigation-pending={workstream.id === pendingWorkstreamId
														? 'true'
														: undefined}
													data-navigation-feedback-only="true"
													data-repository-full-name={row.repo.fullName}
													data-workstream-state={state.tone}
													data-workstream-checkout={workstream.checkoutState}
													data-workstream-draft={hasDraft ? 'true' : undefined}
													onpointerdown={(event) =>
														previewDestinationFromPointer(event, workstream.id, targetSessionId)}
													onpointerup={() =>
														scheduleAbandonedDestinationPreviewCleanup(
															rowHref(workstream.id, targetSessionId),
														)}
													onpointercancel={() =>
														abandonDestinationPreview(rowHref(workstream.id, targetSessionId))}
													onpointerleave={() =>
														abandonDestinationPreview(rowHref(workstream.id, targetSessionId))}
													onkeydown={(event) =>
														previewDestinationFromKeyboard(event, workstream.id, targetSessionId)}
													onkeyup={(event) =>
														scheduleKeyboardDestinationPreviewCleanup(
															event,
															rowHref(workstream.id, targetSessionId),
														)}
													onblur={() =>
														scheduleAbandonedDestinationPreviewCleanup(
															rowHref(workstream.id, targetSessionId),
														)}
													ondragstart={() =>
														abandonDestinationPreview(rowHref(workstream.id, targetSessionId))}
													onclick={(event) =>
														beginWorkstreamNavigation(event, workstream.id, label, targetSessionId)}
												>
													<Tooltip
														content={visualStateTooltip(state, chat, pullRequest)}
														placement="right"
														class="shrink-0"
													>
														<span
															class={[
																'relative grid h-4 w-4 place-items-center',
																busy || state.tone === 'broken' ? state.icon : pullRequest.color,
															]}
															role="status"
															aria-label={`Workstream status: ${visualStateTooltip(state, chat, pullRequest)}`}
															data-testid={state.tone === 'running'
																? 'sidebar-workstream-loader'
																: 'sidebar-workstream-status'}
															data-workstream-icon-state={state.tone}
															data-workstream-pull-request-state={pullRequestState}
														>
															{#if busy}
																<BusyIcon size={14} />
															{:else}
																<Icon name={pullRequest.glyph} size={14} />
															{/if}
															{#if queueCount > 0}
																<span
																	class="bg-brand text-brand-content ring-border-default absolute -right-1.5 -bottom-1 grid min-h-3 min-w-3 place-items-center rounded-full px-0.5 text-[8px] leading-3 font-medium tabular-nums ring-1"
																	aria-hidden="true"
																	data-testid="sidebar-prompt-queue-count"
																>
																	{queueCount}
																</span>
															{/if}
														</span>
													</Tooltip>
													{#if attention}
														<span
															class={[
																'absolute top-1/2 left-2.5 h-1.5 w-1.5 -translate-y-1/2 rounded-full',
																attention.kind === 'failed'
																	? 'bg-error-content'
																	: attention.kind === 'approval'
																		? 'bg-warning-content'
																		: 'bg-brand',
															]}
															aria-hidden="true"
															data-testid="sidebar-agent-attention"
															data-attention-kind={attention.kind}
														></span>
													{/if}
													<span class="sidebar-row-text gap-1.5">
														<Tooltip
															content={label}
															placement="right"
															class="min-w-0 flex-1 truncate"
														>
															<span class="min-w-0 flex-1 truncate">
																<SensitiveText text={label} />
															</span>
														</Tooltip>
														{#if hasDraft}
															<span
																class="text-fg-tertiary shrink-0 group-focus-within/row:invisible group-hover/row:invisible"
																aria-hidden="true"
																data-testid="sidebar-workstream-draft"
															>
																<Icon name="pencil" class="shrink-0" size={14} />
															</span>
														{/if}
														{#if changeTotals && (changeTotals.additions > 0 || changeTotals.deletions > 0)}
															<span
																class="text-3xs flex shrink-0 gap-1 font-mono font-medium tabular-nums group-focus-within/row:invisible group-hover/row:invisible"
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
																class="text-3xs text-fg-tertiary shrink-0 font-mono font-medium tabular-nums group-focus-within/row:invisible group-hover/row:invisible"
																data-testid="sidebar-workstream-changed-files"
																data-files={changeTotals.files}
															>
																{formatCompactChangeTotal(changeTotals.files)}
																{changeTotals.files === 1 ? 'file' : 'files'}
															</span>
														{/if}
													</span>
												</a>
												<Tooltip
													content={lifecycle.tooltip}
													placement="right"
													class="absolute top-1/2 right-1 -translate-y-1/2"
												>
													<IconButton
														variant="ghost"
														size="sm"
														class="pointer-events-none opacity-0 transition-none group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100"
														disabled={!onArchiveWorkstream || lifecycle.kind === 'blocked'}
														ariaLabel={lifecycle.ariaLabel}
														data-testid="sidebar-archive-workstream"
														data-workstream-id={workstream.id}
														data-workstream-lifecycle={lifecycle.kind}
														data-navigation-target={workstream.id === activeWorkstreamId
															? rowHref(null)
															: undefined}
														data-navigation-path-id={workstream.id === activeWorkstreamId
															? 'expected-path:workstream-lifecycle.exit-active'
															: undefined}
														data-navigation-outcome-key={workstream.id === activeWorkstreamId &&
														lifecycle.archivesNatively
															? 'archived'
															: undefined}
														onclick={(event) => requestArchive(event, workstream)}
													>
														{#if lifecycle.kind === 'discard'}
															<Icon name="trash" size={14} />
														{:else}
															<Icon name="archive" size={14} />
														{/if}
													</IconButton>
												</Tooltip>
											</li>
										{/snippet}
									</WorkstreamChatSummary>
								{/each}
							</ul>
						</li>
					{/each}
				</ul>
			{/if}
		</ScrollableDiv>
	</nav>

	<div class="border-surface-50-border flex shrink-0 items-center gap-1 border-t px-2 py-1.5">
		<RoutinesNavBadge />
		<Tooltip content="Settings" placement="right">
			<IconButton
				variant="ghost"
				size="sm"
				href="/settings"
				ariaLabel="Open settings"
				data-testid="sidebar-open-settings"
			>
				<Icon name="settings" size={15} />
			</IconButton>
		</Tooltip>
	</div>
</SidebarFrame>
