<script module lang="ts">
	import type { SessionId } from '$lib/chat/domain/session';
	import type { WorkstreamId } from '$shared/repositories/repositories.api';

	export type AgentChatTabSelectionState = {
		readonly sessionId: SessionId | null;
		readonly fresh: boolean;
	};

	export type OptimisticActivationEvent = {
		readonly defaultPrevented: boolean;
		readonly button: number;
		readonly metaKey: boolean;
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
	};

	export function activatesClientNavigation(event: OptimisticActivationEvent): boolean {
		return !(
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		);
	}

	export const OPTIMISTIC_SELECTION_RELEASE_MS = 2_000;

	export class AgentChatTabSelection {
		#armedFresh = $state.raw(false);
		#releaseTimer: ReturnType<typeof setTimeout> | null = null;
		readonly #releaseAfterMs: number;

		constructor(releaseAfterMs: number = OPTIMISTIC_SELECTION_RELEASE_MS) {
			this.#releaseAfterMs = releaseAfterMs;
		}

		get armedFresh(): boolean {
			return this.#armedFresh;
		}

		armFresh(): void {
			this.#armedFresh = true;
			this.#scheduleRelease();
		}

		settle(): void {
			this.#clearRelease();
			this.#armedFresh = false;
		}

		dispose(): void {
			this.#clearRelease();
		}

		#scheduleRelease(): void {
			this.#clearRelease();
			this.#releaseTimer = setTimeout(() => {
				this.#releaseTimer = null;
				this.settle();
			}, this.#releaseAfterMs);
		}

		#clearRelease(): void {
			if (this.#releaseTimer === null) return;
			clearTimeout(this.#releaseTimer);
			this.#releaseTimer = null;
		}

		resolve(committed: AgentChatTabSelectionState): AgentChatTabSelectionState {
			if (this.#armedFresh) return { sessionId: null, fresh: true };
			return { sessionId: committed.sessionId, fresh: committed.fresh };
		}
	}
</script>

<script lang="ts">
	import { afterNavigate, goto } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { agentChatIdentity } from '$lib/chat/domain/agent-chat-identity';
	import { modelLabel } from '$shared/providers/providers.api';
	import { closeChatCommand } from '$lib/chat/application/commands/close-chat.command';
	import { closingChatsQuery } from '$lib/chat/application/queries/closing-chats.query.svelte';
	import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
	import type { SessionRecord } from '$lib/chat/domain/session-record';
	import { WorkstreamDocumentTab } from '$lib/extensions/extensions.api';
	import {
		syncWorkstreamChats,
		workstreamTabKey,
		type WorkstreamDocumentTab as StripDocument,
	} from '$shared/shell/workstream-tabs';
	import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';
	import { globalTopBarBandSlot } from '$shared/shell/global-topbar-actions.svelte';
	import { BrowserTab, roveTabFocus } from '$hyper-ui/components/browser-tab';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import OverflowTabsMenu from './chat-tabs/OverflowTabsMenu.svelte';
	import type { OverflowTab } from './chat-tabs/overflow-tabs';
	import { useOverflowTabs } from './chat-tabs/useOverflowTabs.svelte';

	interface Props {
		workstreamId: WorkstreamId;
		activeSessionId: SessionId | null;
		fresh: boolean;
		planMode: boolean;
		disabled?: boolean;
		onnewchat: () => void | Promise<void>;
		onclosefresh: () => void | Promise<void>;
		freshCloseNavigationTarget?: string | undefined;
	}

	type StripEntry =
		| Readonly<{ kind: 'chat'; key: string; session: SessionRecord }>
		| Readonly<{ kind: 'document'; key: string; document: StripDocument }>;

	type StripItem = StripEntry | Readonly<{ kind: 'fresh'; key: string }>;

	let {
		workstreamId,
		activeSessionId,
		fresh,
		planMode,
		disabled = false,
		onnewchat,
		onclosefresh,
		freshCloseNavigationTarget,
	}: Props = $props();
	const closingSessionIds = $derived(closingChatsQuery.data);
	let overflowOpen = $state(false);
	const tabSelection = new AgentChatTabSelection();
	let tabRow: HTMLElement | undefined = $state();
	const bandHost = $derived(globalTopBarBandSlot.host);
	const hostedInBand = $derived(bandHost !== null);
	const routedChatId = $derived(page.url.searchParams.get('agent'));
	let lastRouteWorkstreamId: string | null = null;
	let lastRouteChatId: string | null = null;
	let keepDocumentOnRouteChange = false;

	afterNavigate(() => tabSelection.settle());

	$effect(() => {
		const chatId = routedChatId;
		const switchedChat =
			lastRouteWorkstreamId === workstreamId &&
			lastRouteChatId !== null &&
			chatId !== null &&
			lastRouteChatId !== chatId;
		lastRouteWorkstreamId = workstreamId;
		lastRouteChatId = chatId;
		if (!switchedChat) return;
		if (keepDocumentOnRouteChange) {
			keepDocumentOnRouteChange = false;
			return;
		}
		untrack(() => workstreamTabs.leave(workstreamId));
	});

	let destroying = false;
	onDestroy(() => {
		destroying = true;
	});

	$effect(() => {
		const row = tabRow;
		const host = bandHost;
		if (!row || !host) return;
		const home = row.parentNode;
		const homeAnchor = row.nextSibling;
		host.replaceChildren(row);
		globalTopBarBandSlot.adopted = true;
		measureTabsContainer();
		return () => {
			globalTopBarBandSlot.adopted = false;
			if (destroying || !home?.isConnected) {
				row.remove();
				return;
			}
			home.insertBefore(row, homeAnchor?.parentNode === home ? homeAnchor : null);
			measureTabsContainer();
		};
	});

	const openSessions = $derived.by(() =>
		workstreamChatsQuery
			.data(workstreamId)
			.filter((session) => !closingSessionIds.has(session.id))
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
	);
	const strip = $derived(
		syncWorkstreamChats(
			workstreamTabs.for(workstreamId),
			openSessions.map(({ id }) => id),
			routedChatId,
		),
	);
	const entries = $derived.by((): readonly StripEntry[] => {
		const openById = new Map(openSessions.map((session) => [session.id, session]));
		return strip.tabs.flatMap((tab): StripEntry[] => {
			const key = workstreamTabKey(tab);
			if (tab.kind === 'document') return [{ kind: 'document', key, document: tab }];
			const session = openById.get(tab.id);
			return session ? [{ kind: 'chat', key, session }] : [];
		});
	});
	const sessions = $derived(
		entries.flatMap((entry) => (entry.kind === 'chat' ? [entry.session] : [])),
	);
	const documentActive = $derived(strip.activeDocumentId !== null);

	$effect(() => {
		const chatIds = openSessions.map(({ id }) => id);
		const routed = routedChatId;
		const stripWorkstreamId = workstreamId;
		untrack(() => workstreamTabs.syncChats(stripWorkstreamId, chatIds, routed));
	});

	const selection = $derived(tabSelection.resolve({ sessionId: activeSessionId, fresh }));
	const selectedSessionId = $derived(selection.sessionId);
	const freshSelected = $derived(selection.fresh);
	const selectedKey = $derived(
		strip.activeDocumentId !== null
			? `document:${strip.activeDocumentId}`
			: selectedSessionId
				? `chat:${selectedSessionId}`
				: null,
	);
	const overflowTabs = useOverflowTabs({
		getItems: () => entries,
		getId: (entry) => entry.key,
		getPinnedId: () => selectedKey,
		gap: 1,
		minItemWidth: 96,
		fallbackVisibleCount: 3,
	});
	const hiddenEntries = $derived(overflowTabs.hidden);
	const hiddenTabs = $derived(hiddenEntries.map(overflowTab));
	const stripItems = $derived.by((): readonly StripItem[] => {
		const visibleKeys = new Set(overflowTabs.visible.map(({ key }) => key));
		const freshAfterKey = strip.fresh ? strip.fresh.afterKey : strip.anchorKey;
		const items: StripItem[] = [];
		for (const entry of entries) {
			if (visibleKeys.has(entry.key)) items.push(entry);
			if (freshSelected && entry.key === freshAfterKey) {
				items.push({ kind: 'fresh', key: 'fresh' });
			}
		}
		if (freshSelected && !items.some(({ kind }) => kind === 'fresh')) {
			items.push({ kind: 'fresh', key: 'fresh' });
		}
		return items;
	});
	const selectedTabKey = $derived(selectedKey ?? (freshSelected ? 'fresh' : null));
	const tabStopKey = $derived(
		stripItems.find(({ key }) => key === selectedTabKey)?.key ?? stripItems[0]?.key,
	);
	const tabStripId = $props.id();
	const ownedTabIds = $derived(stripItems.map(({ key }) => stripTabId(key)).join(' '));
	const observeTabsContainer = overflowTabs.observeContainer;
	const measureTabsContainer = overflowTabs.measureContainer;
	const measureTabs = overflowTabs.measureItems;

	onMount(() => {
		function onKeydown(event: KeyboardEvent): void {
			if (
				hiddenEntries.length === 0 ||
				!(event.metaKey || event.ctrlKey) ||
				event.shiftKey ||
				event.altKey ||
				event.key.toLocaleLowerCase() !== 'k'
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			overflowOpen = true;
		}
		window.addEventListener('keydown', onKeydown, { capture: true });
		return () => {
			window.removeEventListener('keydown', onKeydown, { capture: true });
			tabSelection.dispose();
		};
	});

	function selectSessionTab(event: MouseEvent): void {
		if (!activatesClientNavigation(event)) return;
		workstreamTabs.leave(workstreamId);
		tabSelection.settle();
	}

	function startFreshChat(): void {
		workstreamTabs.startFreshChat(workstreamId);
		void onnewchat();
	}

	function overflowTab(entry: StripEntry): OverflowTab {
		if (entry.kind === 'document') {
			const file = entry.document;
			return {
				key: entry.key,
				name: file.label,
				detail: file.tooltip,
				selected: strip.activeDocumentId === file.id,
				open: () => workstreamTabs.select(workstreamId, file.id),
			};
		}
		const session = entry.session;
		const identity = agentChatIdentity(session);
		return {
			key: entry.key,
			name: identity.name,
			detail: identity.statusLabel,
			selected: !documentActive && selectedSessionId === session.id,
			open: () => {
				workstreamTabs.leave(workstreamId);
				location.assign(sessionHref(session));
			},
		};
	}

	function stripTabId(key: string): string {
		return `${tabStripId}-${encodeURIComponent(key)}`;
	}

	function sessionLabel(session: SessionRecord): string {
		return session.model ? modelLabel(session.model) : 'Agent';
	}

	function sessionTooltip(session: SessionRecord): string {
		const identity = agentChatIdentity(session);
		const agentAndModel = `Agent · ${sessionLabel(session)}`;
		return identity.activity === 'idle'
			? agentAndModel
			: `${identity.statusLabel} · ${agentAndModel}`;
	}

	function sessionTone(session: SessionRecord): string {
		switch (agentChatIdentity(session).activity) {
			case 'needs-approval':
				return 'text-warning-content';
			case 'failed':
				return 'text-error-content';
			default:
				return 'text-fg-tertiary';
		}
	}

	function sessionHref(session: SessionRecord): string {
		const next = new URL(page.url);
		next.searchParams.set('agent', session.id);
		return `${next.pathname}${next.search}`;
	}

	function freshSessionHref(): string | undefined {
		if (!page.url.searchParams.has('agent')) return undefined;
		const next = new URL(page.url);
		next.searchParams.delete('agent');
		return `${next.pathname}${next.search}`;
	}

	function closeSessionNavigationTarget(session: SessionRecord): string | undefined {
		if (page.url.searchParams.get('agent') !== session.id) return undefined;
		const sessionIndex = sessions.findIndex((candidate) => candidate.id === session.id);
		const adjacentSession = sessions[sessionIndex + 1] ?? sessions[sessionIndex - 1] ?? null;
		const next = new URL(page.url);
		if (adjacentSession) next.searchParams.set('agent', adjacentSession.id);
		else next.searchParams.delete('agent');
		return `${next.pathname}${next.search}`;
	}

	async function focusSessionTab(sessionId: SessionId | null): Promise<void> {
		await tick();
		if (!sessionId) return;
		document
			.querySelector<HTMLElement>(
				`[data-testid="chat-agent-tab"][data-session-id="${CSS.escape(sessionId)}"]`,
			)
			?.focus({ preventScroll: true });
	}

	function closeSession(event: MouseEvent, session: SessionRecord): void {
		event.preventDefault();
		event.stopPropagation();
		const closingIndex = sessions.findIndex((candidate) => candidate.id === session.id);
		const adjacentSession =
			closingIndex >= 0 ? (sessions[closingIndex + 1] ?? sessions[closingIndex - 1] ?? null) : null;
		const wasRouted = page.url.searchParams.get('agent') === session.id;

		closeChatCommand(workstreamId, session.id);
		workstreamTabs.closeChat(workstreamId, session.id);
		if (wasRouted) {
			keepDocumentOnRouteChange = documentActive && adjacentSession !== null;
			if (!adjacentSession) tabSelection.armFresh();
			const next = new URL(page.url);
			if (adjacentSession) next.searchParams.set('agent', adjacentSession.id);
			else next.searchParams.delete('agent');
			void goto(`${next.pathname}${next.search}`, { replaceState: true, noScroll: true });
		}
		void focusSessionTab(adjacentSession?.id ?? selectedSessionId);
	}
</script>

<div
	bind:this={tabRow}
	class={['flex items-center', hostedInBand ? 'min-w-0 flex-1' : 'h-12 shrink-0 px-3 py-2']}
	data-band-hosted={hostedInBand ? 'true' : undefined}
	data-testid="chat-agent-tabs"
>
	<div class="relative flex min-w-0 flex-1 items-center gap-px overflow-hidden" use:roveTabFocus>
		<div
			class="pointer-events-none absolute inset-0"
			role="tablist"
			aria-label="Chats and files"
			aria-owns={ownedTabIds}
			use:observeTabsContainer
		></div>
		{#each stripItems as item (item.key)}
			{#if item.kind === 'chat'}
				{@const session = item.session}
				{@const identity = agentChatIdentity(session)}
				{@const isSelected = selectedSessionId === session.id && !documentActive}
				{@const isCommitted = activeSessionId === session.id}
				{@const isPending = isSelected && !isCommitted}
				{@const isActivePlan = isCommitted && planMode}
				{@const isActivePlanSurface = isSelected && isActivePlan}
				{#snippet statusIcon()}
					<Tooltip content={sessionTooltip(session)} placement="top" class="shrink-0">
						<span
							class={['grid h-4 w-4 place-items-center', isActivePlan ? '' : sessionTone(session)]}
							aria-hidden="true"
						>
							{#if identity.activity === 'needs-approval'}
								<Icon name="circle-dot" size={12} />
							{:else}
								<Icon name="warning" size={12} />
							{/if}
						</span>
					</Tooltip>
				{/snippet}
				<BrowserTab
					surface="band"
					tone={isActivePlanSurface ? 'brand' : 'neutral'}
					label={identity.name}
					description={identity.activity === 'idle' ? undefined : identity.statusLabel}
					selected={isSelected}
					href={sessionHref(session)}
					tabId={stripTabId(item.key)}
					tabindex={item.key === tabStopKey ? 0 : -1}
					ariaCurrent={isCommitted ? 'page' : undefined}
					closeLabel={`Close ${identity.name}`}
					tooltipPlacement="top"
					tabAttributes={{
						'data-testid': 'chat-agent-tab',
						'data-session-id': session.id,
						'data-session-status': identity.activity,
						'data-navigation-path-id': 'expected-path:transcript.switch-chat',
						'data-navigation-workstream-id': workstreamId,
						'data-navigation-pending': isPending ? 'true' : undefined,
						'data-plan-mode': isActivePlan ? 'true' : undefined,
					}}
					closeAttributes={{
						'data-testid': 'chat-agent-tab-close',
						'data-navigation-target': closeSessionNavigationTarget(session),
						'data-navigation-path-id': 'expected-path:transcript.switch-chat',
					}}
					icon={isActivePlan ? planIcon : undefined}
					busy={identity.activity === 'in-progress'}
					trailing={identity.activity === 'needs-approval' || identity.activity === 'failed'
						? statusIcon
						: undefined}
					onselect={selectSessionTab}
					onclose={(event) => closeSession(event, session)}
				/>
			{:else if item.kind === 'document'}
				<WorkstreamDocumentTab
					{workstreamId}
					document={item.document}
					tabId={stripTabId(item.key)}
					tabindex={item.key === tabStopKey ? 0 : -1}
				/>
			{:else}
				<BrowserTab
					surface="band"
					tone={planMode && !documentActive ? 'brand' : 'neutral'}
					label={planMode ? 'Plan' : 'New chat'}
					selected={!documentActive}
					{disabled}
					tabId={stripTabId(item.key)}
					tabindex={item.key === tabStopKey ? 0 : -1}
					closeLabel={planMode ? 'Close Plan' : 'Close New chat'}
					tooltipPlacement="top"
					tabAttributes={{
						'data-testid': 'chat-agent-fresh',
						'data-navigation-pending': fresh ? undefined : 'true',
						'data-navigation-target': fresh ? undefined : freshSessionHref(),
						'data-navigation-path-id': 'expected-path:transcript.fresh-chat',
					}}
					closeAttributes={{
						'data-testid': 'chat-agent-fresh-close',
						'data-navigation-target': freshCloseNavigationTarget,
						'data-navigation-path-id': 'expected-path:transcript.switch-chat',
					}}
					icon={planMode ? planIcon : undefined}
					onselect={() => workstreamTabs.leave(workstreamId)}
					onclose={() => void onclosefresh()}
				/>
			{/if}
		{/each}

		{#if hiddenTabs.length > 0}
			<OverflowTabsMenu tabs={hiddenTabs} bind:open={overflowOpen} />
		{/if}

		<Tooltip content="Start a fresh agent chat" placement="top">
			<IconButton
				variant="ghost"
				ariaLabel="Start a fresh chat"
				class="text-fg-tertiary h-7 w-7 rounded-md focus-visible:ring-inset"
				{disabled}
				data-testid="chat-agent-new"
				data-navigation-path-id="expected-path:transcript.fresh-chat"
				onclick={startFreshChat}
			>
				<Icon name="plus" size={13} />
			</IconButton>
		</Tooltip>
	</div>

	<div
		class="pointer-events-none fixed top-[-10000px] left-[-10000px] flex w-max items-center gap-px opacity-0"
		aria-hidden="true"
		inert
		use:measureTabs
	>
		{#each entries as entry (entry.key)}
			<BrowserTab
				surface="band"
				label={entry.kind === 'chat' ? agentChatIdentity(entry.session).name : entry.document.label}
				selected={false}
				preview={entry.kind === 'document' && entry.document.preview}
				closeLabel=""
				icon={entry.kind === 'document' ? iconSpace : undefined}
				trailing={entry.kind === 'chat' &&
				['needs-approval', 'failed'].includes(agentChatIdentity(entry.session).activity)
					? iconSpace
					: undefined}
				onclose={() => undefined}
				data-overflow-measure-item={entry.key}
			/>
		{/each}
		<div class="flex h-7 items-center gap-1 px-3 text-xs" data-overflow-measure-trigger>
			<span class="size-3.5"></span>
			<span>{entries.length}</span>
		</div>
		<div class="flex items-center gap-px" data-overflow-measure-reserved>
			{#if freshSelected}
				<BrowserTab
					surface="band"
					label={planMode ? 'Plan' : 'New chat'}
					selected
					closeLabel=""
					icon={planMode ? iconSpace : undefined}
					onclose={() => undefined}
				/>
			{/if}
			<div class="size-7"></div>
		</div>
	</div>
</div>

{#snippet planIcon()}
	<span class="grid place-items-center" aria-hidden="true">
		<Icon name="route" size={12} />
	</span>
{/snippet}

{#snippet iconSpace()}
	<span class="size-4"></span>
{/snippet}
