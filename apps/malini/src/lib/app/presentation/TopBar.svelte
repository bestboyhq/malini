<script lang="ts">
	import { onMount } from 'svelte';
	import { navigating, page } from '$shared/router/state';
	import {
		historyIndexFromState,
		navigationHistoryTargetLedger,
	} from '$shared/router/history-ledger';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { Popover } from '$hyper-ui/components/popover';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import ForegroundActivityIndicator from './ForegroundActivityIndicator.svelte';
	import { hydrateSidebarCommand } from '$lib/app/application/commands/hydrate-sidebar.command';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { toggleSidebarCommand } from '$lib/app/application/commands/toggle-sidebar.command';
	import { sidebarCollapsedQuery } from '$lib/app/application/queries/sidebar-collapsed.query.svelte';
	import { sidebarPresenceQuery } from '$lib/app/application/queries/sidebar-presence.query.svelte';
	import {
		globalTopBarActionMatchesPathname,
		globalTopBarBandSlotHost,
		globalTopBarGithubStatus,
		type GlobalTopBarAction,
		type GlobalTopBarStatusDetailAction,
	} from '$shared/shell/global-topbar-actions.svelte';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { inspectorDock } from '$shared/shell/inspector-dock.svelte';

	interface Props {
		actions?: readonly GlobalTopBarAction[];
	}

	let { actions = [] }: Props = $props();

	onMount(() => {
		hydrateSidebarCommand();
	});

	const targetPathname = $derived(navigating.to?.url?.pathname ?? page.url.pathname);
	const routeTransitionPending = $derived(navigating.to !== null);
	const sidebarCollapsed = $derived(sidebarCollapsedQuery.data);
	const sidebarMounted = $derived(sidebarPresenceQuery.data);
	const leftClusterTucked = $derived(sidebarCollapsed || !sidebarMounted);
	const canNavigateBack = $derived.by(() => {
		void page.url;
		const index = historyIndexFromState(history.state);
		return index !== null && index > 0;
	});
	const canNavigateForward = $derived.by(() => {
		void page.url;
		return navigationHistoryTargetLedger.adjacent('forward', history.state) !== null;
	});
	const visibleActions = $derived(
		actions.filter((action) => globalTopBarActionMatchesPathname(action, targetPathname)),
	);
	const dockWidth = $derived(inspectorDock.width);
	let rightClusterElement: HTMLDivElement | undefined = $state();
	let rightClusterWidth = $state(0);
	const RIGHT_CLUSTER_GUTTER_PX = 24;
	const topbarRightReserve = $derived(Math.ceil(rightClusterWidth) + RIGHT_CLUSTER_GUTTER_PX);

	$effect(() => {
		const element = rightClusterElement;
		if (!element) return;

		const updateWidth = (): void => {
			rightClusterWidth = element.getBoundingClientRect().width;
		};
		updateWidth();

		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(updateWidth);
		observer.observe(element);
		return () => observer.disconnect();
	});

	const githubStatus = $derived(globalTopBarGithubStatus.current);
	const githubPanelHeadline = $derived(
		githubStatus?.title ?? githubStatus?.branch ?? 'No pull request',
	);
	let githubZoneElement: HTMLDivElement | undefined = $state();
	let githubDisclosureElement: HTMLButtonElement | undefined = $state();
	let githubPopoverOpen = $state(false);
	let githubPopoverAnchor = $state({ x: 0, y: 0 });
	let armedDetailId = $state<string | null>(null);

	const githubPrimaryAction = $derived.by<GlobalTopBarAction | null>(() => {
		const status = githubStatus;
		const action = status?.action;
		if (!action) return null;
		return {
			id: 'github-primary',
			label: action.label,
			ariaLabel: action.ariaLabel,
			tooltip: action.tooltip,
			tone: action.tone,
			icon: action.icon ?? null,
			disabled: action.disabled,
			busy: action.busy,
			testId: 'global-topbar-github-action',
			onInvoke: action.onInvoke,
		};
	});

	const githubSecondaryAction = $derived.by<GlobalTopBarAction | null>(() => {
		const action = githubStatus?.secondaryAction;
		if (!action) return null;
		return {
			id: 'github-secondary',
			label: action.label,
			ariaLabel: action.ariaLabel,
			tooltip: action.tooltip,
			tone: action.tone,
			disabled: action.disabled,
			busy: action.busy,
			testId: 'global-topbar-github-secondary-action',
			onInvoke: action.onInvoke,
		};
	});

	const githubDetailActions = $derived(githubStatus?.detailActions ?? []);
	const githubRemoteFailure = $derived(githubStatus?.remoteFailure ?? null);
	const githubDisclosureTone = $derived(githubPrimaryAction?.tone ?? 'secondary');
	const githubDisclosureLook = $derived.by((): 'busy' | 'disabled' | undefined => {
		if (!githubPrimaryAction) return undefined;
		if (githubPrimaryAction.busy) return 'busy';
		return githubPrimaryAction.disabled || routeTransitionPending ? 'disabled' : undefined;
	});
	const githubDisclosureLabel = $derived(
		githubStatus?.reference ? `Pull request ${githubStatus.reference} detail` : 'Repository detail',
	);

	$effect(() => {
		if (!githubStatus) githubPopoverOpen = false;
	});

	$effect(() => {
		if (githubDetailActions.some((detail) => detail.id === armedDetailId && detail.confirmLabel)) {
			return;
		}
		disarmDetail();
	});

	function disarmDetail(): void {
		armedDetailId = null;
	}

	$effect(() => {
		if (!armedDetailId) return;
		return disarmOnDismiss(disarmDetail);
	});

	$effect(() => {
		if (routeTransitionPending) githubPopoverOpen = false;
	});

	function toggleGithubPopover(): void {
		if (githubPopoverOpen) {
			closeGithubPopover();
			return;
		}
		const rect = githubZoneElement?.getBoundingClientRect();
		if (rect) githubPopoverAnchor = { x: rect.right - 300, y: rect.bottom + 6 };
		githubPopoverOpen = true;
	}

	function closeGithubPopover(): void {
		githubPopoverOpen = false;
	}

	function onBarActionClicked(action: GlobalTopBarAction): void {
		if (action.disabled || action.busy) return;
		closeGithubPopover();
		void action.onInvoke();
	}

	function openPullRequestUrl(url: string): void {
		closeGithubPopover();
		openExternalUrlCommand(url);
	}

	function onDetailActionClicked(detail: GlobalTopBarStatusDetailAction): void {
		if (detail.disabled) return;
		if (detail.confirmLabel && armedDetailId !== detail.id) {
			armedDetailId = detail.id;
			return;
		}
		disarmDetail();
		closeGithubPopover();
		void detail.onInvoke();
	}
</script>

{#snippet githubAction(action: GlobalTopBarAction, split: boolean)}
	<Tooltip content={action.tooltip} placement="bottom">
		<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
		<button
			type="button"
			class="topbar-action topbar-git__action"
			class:topbar-git__action--split={split}
			data-tone={action.tone ?? 'secondary'}
			disabled={action.disabled || action.busy || routeTransitionPending}
			aria-label={action.ariaLabel}
			aria-busy={action.busy || undefined}
			data-testid="global-topbar-github-action"
			onclick={() => onBarActionClicked(action)}
		>
			{#if action.busy}
				<BusyIcon size={12} />
			{:else if action.icon}
				<Icon name={action.icon} size={12} />
			{/if}
			<span>{action.label}</span>
		</button>
	</Tooltip>
{/snippet}

{#snippet githubDisclosure(reference: string | null)}
	<Tooltip content={githubRemoteFailure ?? githubDisclosureLabel} placement="bottom">
		<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
		<button
			bind:this={githubDisclosureElement}
			type="button"
			class={reference ? 'topbar-git__pill-part' : 'topbar-action topbar-git__disclosure'}
			class:topbar-git__disclosure--solo={!reference && !githubPrimaryAction}
			data-tone={reference ? undefined : githubDisclosureTone}
			data-look={reference ? undefined : githubDisclosureLook}
			data-stale={githubRemoteFailure ? '' : undefined}
			data-testid="global-topbar-github-status"
			aria-label={githubRemoteFailure
				? `${githubDisclosureLabel}, remote status is stale`
				: githubDisclosureLabel}
			aria-haspopup="dialog"
			aria-expanded={githubPopoverOpen}
			onclick={toggleGithubPopover}
		>
			{#if reference}
				{reference}
			{:else}
				<Icon name="chevron-down" size={10} />
			{/if}
		</button>
	</Tooltip>
{/snippet}

<nav
	class="global-topbar"
	aria-label="Global actions"
	data-native-drag-region
	data-testid="global-topbar"
	data-sidebar-collapsed={sidebarCollapsed ? '' : undefined}
	style={`--topbar-right-reserve: ${topbarRightReserve}px;`}
>
	<div
		class="topbar-left"
		class:topbar-left--collapsed={leftClusterTucked}
		data-testid="global-topbar-left"
	>
		{#if sidebarMounted}
			<Tooltip content={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} placement="bottom">
				<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-chrome` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
				<button
					type="button"
					class="topbar-chrome"
					aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
					data-testid="global-topbar-sidebar-toggle"
					onclick={toggleSidebarCommand}
				>
					<Icon name="sidebar" />
				</button>
			</Tooltip>
		{/if}
		<div class="topbar-history">
			<Tooltip content="Connect repository" placement="bottom">
				<a
					href="/"
					class="topbar-chrome topbar-chrome--connect"
					aria-label="Connect repository"
					data-testid="global-topbar-connect-repository"
					data-navigation-path-id="expected-path:workstream-sidebar.connect-repository"
				>
					<Icon name="folder-plus" />
				</a>
			</Tooltip>
			<Tooltip content="Go back" placement="bottom">
				<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-chrome` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
				<button
					type="button"
					class="topbar-chrome"
					disabled={!canNavigateBack}
					aria-label="Go back"
					data-testid="global-topbar-history-back"
					onclick={() => history.back()}
				>
					<Icon name="chevron-left" />
				</button>
			</Tooltip>
			<Tooltip content="Go forward" placement="bottom">
				<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-chrome` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
				<button
					type="button"
					class="topbar-chrome"
					disabled={!canNavigateForward}
					aria-label="Go forward"
					data-testid="global-topbar-history-forward"
					onclick={() => history.forward()}
				>
					<Icon name="chevron-right" />
				</button>
			</Tooltip>
		</div>
	</div>
	<div
		class="topbar-band-slot"
		data-testid="global-topbar-band-slot"
		use:globalTopBarBandSlotHost
	></div>
	<div
		bind:this={rightClusterElement}
		class="topbar-right"
		data-docked={dockWidth === null ? undefined : ''}
		style={dockWidth === null ? undefined : `--dock-width: ${dockWidth}px;`}
		data-testid="global-topbar-right"
	>
		{#each visibleActions as action (action.id)}
			<Tooltip content={action.tooltip} placement="bottom">
				<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
				<button
					type="button"
					class="topbar-action"
					data-tone={action.tone ?? 'secondary'}
					disabled={action.disabled || action.busy || routeTransitionPending}
					aria-label={action.ariaLabel}
					aria-busy={action.busy || undefined}
					data-testid={action.testId ?? `global-topbar-action-${action.id}`}
					onclick={() => onBarActionClicked(action)}
				>
					{#if action.busy}
						<BusyIcon size={12} />
					{/if}
					<span>{action.label}</span>
				</button>
			</Tooltip>
		{/each}
		{#if githubStatus?.placeholder}
			<div class="topbar-git" aria-hidden="true" data-testid="global-topbar-github-placeholder">
				<span
					class="topbar-action topbar-git__action--split topbar-git__placeholder"
					data-label={githubStatus.placeholder}
				></span>
				<span class="topbar-action topbar-git__disclosure topbar-git__placeholder"></span>
			</div>
		{:else if githubStatus}
			<div
				bind:this={githubZoneElement}
				class="topbar-git"
				data-zone={githubStatus.headline?.tone}
				data-testid="global-topbar-github"
			>
				{#if githubStatus.reference}
					<div class="topbar-git__pill">
						{@render githubDisclosure(githubStatus.reference)}
						{#if githubStatus.url}
							{@const url = githubStatus.url}
							<Tooltip content="Open on GitHub" placement="bottom">
								<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-git__pill-part` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
								<button
									type="button"
									class="topbar-git__pill-part topbar-git__pill-link"
									aria-label={`Open pull request ${githubStatus.reference} on GitHub`}
									data-testid="global-topbar-github-reference"
									onclick={() => openPullRequestUrl(url)}
								>
									<Icon name="external-link" size={12} />
								</button>
							</Tooltip>
						{/if}
					</div>
				{/if}
				{#if githubStatus.headline}
					{@const headline = githubStatus.headline}
					<Tooltip
						content={headline.detail ?? headline.label}
						placement="bottom"
						class="mr-auto min-w-0"
					>
						<span
							class="topbar-git__headline"
							data-tone={headline.tone}
							role="status"
							data-testid="global-topbar-github-headline"
						>
							{#if headline.tone === 'progress'}
								<BusyIcon size={12} />
							{/if}
							<span class="topbar-git__headline-label">{headline.label}</span>
						</span>
					</Tooltip>
				{/if}
				{#if githubSecondaryAction}
					{@const action = githubSecondaryAction}
					<Tooltip content={action.tooltip} placement="bottom">
						<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
						<button
							type="button"
							class="topbar-action topbar-git__secondary"
							data-tone="secondary"
							disabled={action.disabled || routeTransitionPending}
							aria-label={action.ariaLabel}
							aria-busy={action.busy || undefined}
							data-testid="global-topbar-github-secondary-action"
							onclick={() => onBarActionClicked(action)}
						>
							{#if action.busy}
								<BusyIcon size={12} />
							{/if}
							<span>{action.label}</span>
						</button>
					</Tooltip>
				{/if}
				{#if githubStatus.reference}
					{#if githubPrimaryAction}
						{@render githubAction(githubPrimaryAction, false)}
					{/if}
				{:else}
					<div class="topbar-git__split">
						{#if githubPrimaryAction}
							{@render githubAction(githubPrimaryAction, true)}
						{/if}
						{@render githubDisclosure(null)}
					</div>
				{/if}
			</div>
			<Popover
				open={githubPopoverOpen}
				x={githubPopoverAnchor.x}
				y={githubPopoverAnchor.y}
				anchor={githubDisclosureElement ?? null}
				onclose={closeGithubPopover}
				label={githubDisclosureLabel}
				panelClass="rounded-lg border-[0.5px] border-surface-elevated-border bg-surface-elevated"
				testId="global-topbar-github-popover"
				owner="global-topbar-github"
			>
				{#snippet children()}
					<div class="github-panel">
						<div class="github-panel__header">
							<div class="github-panel__identity">
								{#if githubStatus.reference}
									<span class="github-panel__reference">{githubStatus.reference}</span>
								{/if}
								<span class="github-panel__title">
									{githubPanelHeadline}
								</span>
							</div>
							{#if githubStatus.branch && githubStatus.branch !== githubPanelHeadline}
								<p class="github-panel__branch">{githubStatus.branch}</p>
							{/if}
						</div>

						{#if githubRemoteFailure}
							<div
								class="github-panel__stale"
								data-testid="global-topbar-github-remote-failure"
								role="status"
							>
								<span class="tone-dot" data-tone="warning" aria-hidden="true"></span>
								<span class="github-panel__stale-detail">{githubRemoteFailure}</span>
							</div>
						{/if}

						<div class="github-panel__section">
							<div class="github-panel__section-head">
								<span>Checks</span>
								<span class="github-panel__section-meta">{githubStatus.checksSummary}</span>
							</div>
							{#if githubStatus.checks.length > 0}
								<ul class="github-panel__checks">
									{#each githubStatus.checks as check (check.id)}
										<li class="github-panel__check" data-blocking={check.blocking}>
											<span class="tone-dot" data-tone={check.tone} aria-hidden="true"></span>
											<span class="github-panel__check-name">{check.name}</span>
											<span class="github-panel__check-detail">{check.detail}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>

						{#if githubStatus.changes || githubStatus.review || githubStatus.todos}
							<ul class="github-panel__notes">
								{#if githubStatus.changes}
									<li class="github-panel__note">
										<span
											class="tone-dot"
											data-tone={githubStatus.changes.tone}
											aria-hidden="true"
										></span>
										<span>Changes</span>
										<span class="github-panel__note-value">{githubStatus.changes.label}</span>
									</li>
								{/if}
								{#if githubStatus.review}
									<li class="github-panel__note">
										<span
											class="tone-dot"
											data-tone={githubStatus.review.tone}
											aria-hidden="true"
										></span>
										<span>Review</span>
										<span class="github-panel__note-value">{githubStatus.review.label}</span>
									</li>
								{/if}
								{#if githubStatus.todos}
									<li class="github-panel__note">
										<span
											class="tone-dot"
											data-tone={githubStatus.todos.tone}
											aria-hidden="true"
										></span>
										<span>Todos</span>
										<span class="github-panel__note-value">{githubStatus.todos.label}</span>
									</li>
								{/if}
							</ul>
						{/if}

						<div class="github-panel__footer">
							{#if githubStatus.url}
								{@const url = githubStatus.url}
								<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
								<button
									type="button"
									class="github-panel__link"
									data-testid="global-topbar-github-open"
									onclick={() => openPullRequestUrl(url)}
								>
									Open on GitHub
								</button>
							{/if}
							{#each githubDetailActions as detail (detail.id)}
								{@const armed = armedDetailId === detail.id}
								<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- the top bar draws `topbar-action` and `github-panel__link` from this component's own scoped style block, and Svelte scoping does not reach a child component's element, so a Button here would render unstyled. -->
								<button
									type="button"
									class="github-panel__link"
									disabled={detail.disabled || undefined}
									data-armed={armed || undefined}
									data-testid={`global-topbar-github-detail-${detail.id}`}
									onclick={() => onDetailActionClicked(detail)}
								>
									{armed ? detail.confirmLabel : detail.label}
								</button>
							{/each}
						</div>
					</div>
				{/snippet}
			</Popover>
		{/if}
		<ForegroundActivityIndicator />
	</div>
</nav>

<style>
	.global-topbar {
		--topbar-side-reserve: 0px;
		display: none;
	}

	:global(html[data-native-shell='true']) .global-topbar {
		--topbar-side-reserve: var(--native-traffic-light-clearance);
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		display: grid;
		grid-template-columns:
			var(--shell-sidebar-left, var(--topbar-side-reserve))
			minmax(0, var(--shell-sidebar-width, min(48vw, 680px)))
			minmax(0, 1fr)
			auto;
		align-items: center;
		height: var(--native-titlebar-safe-area);
		z-index: 50;
		background: transparent;
		border-bottom: none;
		padding-right: 12px;

		pointer-events: none;
	}

	:global(html[data-native-shell='true']) .global-topbar > * {
		pointer-events: auto;
	}

	:global(html[data-native-shell='true']) .global-topbar[data-sidebar-collapsed] {
		grid-template-columns:
			max-content
			0px
			minmax(0, 1fr)
			auto;
	}

	:global(html[data-native-shell='true']) .global-topbar .topbar-left {
		pointer-events: none;
	}

	.topbar-left {
		grid-column: 1 / 3;
		display: flex;
		min-width: 0;
		align-items: center;
		gap: calc(4px / var(--native-zoom, 1));
		padding-left: var(--native-traffic-light-clearance);
		padding-right: calc(6px / var(--native-zoom, 1));
	}

	.topbar-history {
		display: flex;
		align-items: center;
		gap: calc(2px / var(--native-zoom, 1));
		margin-left: auto;
	}

	.topbar-left--collapsed .topbar-history {
		margin-left: 0;
	}

	.topbar-chrome {
		display: inline-flex;
		height: calc(28px / var(--native-zoom, 1));
		width: calc(28px / var(--native-zoom, 1));
		flex-shrink: 0;
		cursor: pointer;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: calc(7px / var(--native-zoom, 1));
		background: transparent;
		padding: 0;
		color: var(--color-fg-secondary);
		pointer-events: auto;
		transition: color var(--default-transition-duration) ease;
	}

	.topbar-chrome :global(svg) {
		height: calc(16px / var(--native-zoom, 1));
		width: calc(16px / var(--native-zoom, 1));
	}

	.topbar-chrome--connect :global(svg) {
		height: calc(14px / var(--native-zoom, 1));
		width: calc(14px / var(--native-zoom, 1));
	}

	.topbar-chrome:hover:not(:disabled) {
		background: var(--color-surface-150-hover);
		color: var(--color-fg-default);
	}

	.topbar-chrome:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-button-primary) 40%, transparent);
		outline-offset: 1px;
	}

	.topbar-chrome:disabled {
		cursor: default;
		color: var(--color-button-disabled-content);
	}

	.topbar-band-slot {
		grid-column: 3;
		display: flex;
		min-width: 0;
		align-items: center;
		overflow: hidden;
		padding-left: 12px;
	}

	.topbar-band-slot:empty {
		pointer-events: none;
	}

	.topbar-right {
		grid-column: 4;
		display: flex;
		width: max-content;
		max-width: min(400px, calc(50vw - 128px));
		min-width: 0;
		align-items: center;
		justify-self: end;
		gap: 4px;
	}

	.topbar-right[data-docked] {
		--dock-tint: transparent;
		--dock-edge: var(--color-surface-50-border);
		align-self: end;
		width: var(--dock-width);
		max-width: none;
		height: 68px;
		margin-bottom: -40px;
		border: 0.5px solid var(--dock-edge);
		border-bottom: 0;
		border-radius: 24px 24px 0 0;
		background: linear-gradient(var(--dock-tint), var(--dock-tint)), var(--color-surface-50);
		padding: 0 16px 24px;
	}

	.topbar-right[data-docked]:not(:has(> *)) {
		display: none;
	}

	.topbar-right[data-docked]:has(.topbar-git[data-zone='success']) {
		--dock-tint: var(--color-success);
		--dock-edge: color-mix(in srgb, var(--color-success-content) 40%, transparent);
	}

	.topbar-right[data-docked]:has(.topbar-git[data-zone='warning']) {
		--dock-tint: var(--color-warning);
		--dock-edge: color-mix(in srgb, var(--color-warning-content) 40%, transparent);
	}

	.topbar-right[data-docked]:has(.topbar-git[data-zone='danger']) {
		--dock-tint: var(--color-error);
		--dock-edge: color-mix(in srgb, var(--color-error-content) 40%, transparent);
	}

	.topbar-right[data-docked]:has(.topbar-git[data-zone='merged']) {
		--dock-tint: color-mix(in srgb, var(--color-merged-content) 10%, transparent);
		--dock-edge: color-mix(in srgb, var(--color-merged-content) 40%, transparent);
	}

	.topbar-right[data-docked] .topbar-git {
		flex: 1 1 auto;
	}

	.topbar-right[data-docked] .topbar-git[data-zone] {
		height: auto;
		border: 0;
		border-radius: 0;
		background: transparent;
		padding: 0;
	}

	.topbar-right :global(.foreground-activity) {
		min-width: 0;
		flex: 1 1 auto;
	}

	.topbar-action {
		display: inline-flex;
		flex-shrink: 0;
		height: var(--topbar-control-height, 26px);
		cursor: pointer;
		align-items: center;
		gap: 6px;
		border: 0.5px solid var(--color-button-secondary-border);
		border-radius: var(--topbar-control-radius, 7px);
		background: color-mix(in srgb, var(--color-surface-150) 68%, transparent);
		padding: 0 10px;
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--color-fg-secondary);
		transition:
			border-color var(--default-transition-duration) ease,
			color var(--default-transition-duration) ease;
	}

	.topbar-action[data-tone='primary'] {
		border-color: transparent;
		background: var(--color-button-primary);
		color: var(--color-button-primary-content);
	}

	.topbar-action:hover:not(:disabled) {
		background: var(--color-button-secondary-hover);
		color: var(--color-fg-default);
	}

	.topbar-action[data-tone='primary']:hover:not(:disabled) {
		background: var(--color-button-primary-hover);
		color: var(--color-button-primary-content);
	}

	.topbar-action:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-button-primary) 40%, transparent);
		outline-offset: 1px;
	}

	.topbar-action:disabled {
		cursor: not-allowed;
		border-color: transparent;
		background: var(--color-button-disabled);
		color: var(--color-button-disabled-content);
	}

	.topbar-action[aria-busy='true'] {
		cursor: progress;
		border-color: transparent;
		background: var(--color-button-secondary-busy);
		color: var(--color-fg-default);
	}

	.topbar-action[data-tone='primary'][aria-busy='true'] {
		background: var(--color-button-primary-busy);
		color: var(--color-button-primary-busy-content);
	}

	.tone-dot {
		display: inline-block;
		height: 6px;
		width: 6px;
		flex-shrink: 0;
		border-radius: 9999px;
		background: var(--color-fg-tertiary);
	}

	.tone-dot[data-tone='progress'] {
		background: var(--color-fg-tertiary);
	}

	.tone-dot[data-tone='success'] {
		background: var(--color-success-content);
	}

	.tone-dot[data-tone='warning'] {
		background: var(--color-warning-content);
	}

	.tone-dot[data-tone='danger'] {
		background: var(--color-error-content);
	}

	.topbar-git {
		--zone-ink: var(--color-fg-secondary);
		--zone-edge: var(--color-button-secondary-border);
		--zone-hover: var(--color-button-secondary-hover);
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
	}

	.topbar-git[data-zone] {
		--topbar-control-height: 24px;
		--topbar-control-radius: 5px;
		height: 32px;
		gap: 12px;
		border: 0.5px solid var(--zone-edge);
		border-radius: 9px;
		background: color-mix(in srgb, var(--color-surface-150) 68%, transparent);
		padding: 0 3.5px;
	}

	.topbar-git[data-zone='success'] {
		--zone-ink: var(--color-success-content);
		background: var(--color-success);
	}

	.topbar-git[data-zone='warning'] {
		--zone-ink: var(--color-warning-content);
		background: var(--color-warning);
	}

	.topbar-git[data-zone='danger'] {
		--zone-ink: var(--color-error-content);
		background: var(--color-error);
	}

	.topbar-git[data-zone='merged'] {
		--zone-ink: var(--color-merged-content);
		background: color-mix(in srgb, var(--color-merged-content) 10%, transparent);
	}

	.topbar-git:is(
		[data-zone='success'],
		[data-zone='warning'],
		[data-zone='danger'],
		[data-zone='merged']
	) {
		--zone-edge: color-mix(in srgb, var(--zone-ink) 20%, transparent);
		--zone-hover: color-mix(in srgb, var(--zone-ink) 10%, transparent);
		--color-button-primary: var(--zone-ink);
		--color-button-primary-hover: color-mix(in srgb, var(--zone-ink) 88%, transparent);
		--color-button-primary-busy: color-mix(in srgb, var(--zone-ink) 60%, transparent);
	}

	.topbar-git[data-zone] .topbar-git__action {
		gap: 4px;
		padding: 0 8px;
	}

	.topbar-git__split {
		display: flex;
		flex-shrink: 0;
		align-items: center;
	}

	.topbar-git__pill {
		display: flex;
		height: var(--topbar-control-height, 26px);
		flex-shrink: 0;
		overflow: hidden;
		border: 0.5px solid var(--zone-edge);
		border-radius: var(--topbar-control-radius, 7px);
		font-size: var(--text-2xs);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--zone-ink);
	}

	.topbar-git__pill-part {
		display: inline-flex;
		cursor: pointer;
		align-items: center;
		border: 0;
		background: transparent;
		padding: 0 8px;
		color: inherit;
	}

	.topbar-git__pill-part:hover,
	.topbar-git__pill-part[aria-expanded='true'] {
		background: var(--zone-hover);
	}

	.topbar-git__pill-part:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-button-primary) 40%, transparent);
		outline-offset: -2px;
	}

	.topbar-git__pill-link {
		border-left: 0.5px solid var(--zone-edge);
		padding: 0 6px;
	}

	.topbar-git__headline {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		padding: 0 4px;
		font-size: var(--text-sm);
		font-weight: 500;
		white-space: nowrap;
		color: var(--zone-ink);
	}

	.topbar-git__headline-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.topbar-git__secondary {
		border-width: 1px;
		border-style: dashed;
		background: transparent;
	}

	.topbar-git__action--split {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-right-width: 0;
	}

	.topbar-git__disclosure {
		width: 22px;
		justify-content: center;
		padding: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.topbar-git__disclosure--solo {
		border-radius: var(--topbar-control-radius, 7px);
	}

	.topbar-git__disclosure[data-look='busy'] {
		border-color: transparent;
		background: var(--color-button-secondary-busy);
		color: var(--color-fg-default);
	}

	.topbar-git__disclosure[data-tone='primary'][data-look='busy'] {
		background: var(--color-button-primary-busy);
		color: var(--color-button-primary-busy-content);
	}

	.topbar-git__disclosure[data-look='disabled'] {
		border-color: transparent;
		background: var(--color-button-disabled);
		color: var(--color-button-disabled-content);
	}

	.topbar-git__placeholder {
		cursor: default;
		border-color: transparent;
		background: var(--color-surface-root-selected);
	}

	.topbar-git__placeholder[data-label]::before {
		content: attr(data-label);
		visibility: hidden;
	}

	.topbar-git [data-stale] {
		position: relative;
	}

	.topbar-git [data-stale]::after {
		content: '';
		position: absolute;
		top: 3px;
		right: 3px;
		height: 5px;
		width: 5px;
		border-radius: 9999px;
		background: var(--color-warning-content);
	}

	.topbar-git__disclosure[aria-expanded='true'] {
		background: var(--color-button-secondary-hover);
		color: var(--color-fg-default);
	}

	.topbar-git__disclosure[data-tone='primary'][aria-expanded='true'] {
		background: var(--color-button-primary-hover);
		color: var(--color-button-primary-content);
	}

	.github-panel {
		display: flex;
		width: 300px;
		flex-direction: column;
		font-size: var(--text-2xs);
		line-height: var(--text-2xs--line-height);
		color: var(--color-fg-secondary);
	}

	.github-panel__header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 12px 10px;
	}

	.github-panel__identity {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.github-panel__reference {
		flex-shrink: 0;
		color: var(--color-fg-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.github-panel__title {
		overflow: hidden;
		color: var(--color-fg-default);
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.github-panel__branch {
		margin: 0;
		overflow: hidden;
		color: var(--color-fg-tertiary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.github-panel__stale {
		display: flex;
		align-items: center;
		gap: 8px;
		border-top: 0.5px solid var(--color-surface-elevated-border);
		background: color-mix(in srgb, var(--color-warning-content) 8%, transparent);
		padding: 8px 12px;
		min-width: 0;
	}

	.github-panel__stale-detail {
		min-width: 0;
		overflow: hidden;
		color: var(--color-fg-default);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.github-panel__section {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-top: 0.5px solid var(--color-surface-elevated-border);
		padding: 8px 12px;
	}

	.github-panel__section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: var(--color-fg-tertiary);
	}

	.github-panel__section-meta {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.github-panel__checks {
		display: flex;
		max-height: 168px;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;
	}

	.github-panel__check,
	.github-panel__note {
		display: flex;
		min-height: 20px;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.github-panel__check-name {
		overflow: hidden;
		flex: 1 1 auto;
		color: var(--color-fg-default);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.github-panel__check[data-blocking='false'] .github-panel__check-name {
		color: var(--color-fg-secondary);
	}

	.github-panel__check-detail {
		flex-shrink: 0;
		color: var(--color-fg-tertiary);
	}

	.github-panel__notes {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		border-top: 0.5px solid var(--color-surface-elevated-border);
		padding: 8px 12px;
		list-style: none;
	}

	.github-panel__note-value {
		margin-left: auto;
		overflow: hidden;
		color: var(--color-fg-default);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.github-panel__footer {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		border-top: 0.5px solid var(--color-surface-elevated-border);
		padding: 6px 8px;
	}

	.github-panel__footer:empty {
		display: none;
	}

	.github-panel__link {
		display: inline-flex;
		height: 22px;
		flex-shrink: 0;
		cursor: pointer;
		align-items: center;
		border-radius: 6px;
		background: transparent;
		padding: 0 6px;
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--color-fg-secondary);
		transition: color var(--default-transition-duration) ease;
	}

	.github-panel__link:hover:not(:disabled) {
		background: var(--color-surface-150-hover);
		color: var(--color-fg-default);
	}

	.github-panel__link:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-button-primary) 40%, transparent);
		outline-offset: 1px;
	}

	.github-panel__link[data-armed],
	.github-panel__link[data-armed]:hover:not(:disabled) {
		background: var(--color-error);
		color: var(--color-error-content);
	}

	.github-panel__link:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
