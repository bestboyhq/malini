<script lang="ts">
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import { currentPlanLimits, planLimitAlert } from '$lib/chat/domain/plan-usage';
	import { liveContextUsageQuery } from '$lib/chat/application/queries/live-context-usage.query.svelte';
	import { planUsageQuery } from '$lib/chat/application/queries/plan-usage.query.svelte';
	import { refreshSessionStatusCommand } from '$lib/chat/application/commands/refresh-session-status.command';
	import { loadTurnedOffMcpServersCommand } from '$lib/chat/application/commands/load-turned-off-mcp-servers.command';
	import { turnedOffMcpServersQuery } from '$lib/chat/application/queries/turned-off-mcp-servers.query.svelte';
	import { groupMcpServers, needsYouCount } from '$lib/chat/domain/mcp-server';
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';
	import { ClaudeAccountList, claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import { goto } from '$shared/router/navigation';
	import { ACCOUNT_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import {
		contextBreakdown,
		contextPressure,
		contextPressureAdvice,
		contextRemainingTokens,
		contextUnavailableMessage,
		contextUsagePercent,
		contextWindowUnknownMessage,
		usagePressure,
		withLiveContext,
		type ContextPressure,
	} from './session-runtime-metadata';
	import McpStatusPanel from './McpStatusPanel.svelte';
	import { TranscriptFactsProjector } from './transcript-facts';

	interface Props {
		envelopes: readonly EventEnvelope[];
		sessionId?: SessionId | null;
		workstreamId?: string | null;
	}

	let { envelopes, sessionId = null, workstreamId = null }: Props = $props();
	let contextOpen = $state(false);
	let mcpOpen = $state(false);
	let nowMs = $state(Date.now());
	const liveContext = $derived(sessionId ? liveContextUsageQuery.data(sessionId) : null);
	const planUsage = $derived(planUsageQuery.data);
	const transcriptFactsProjector = new TranscriptFactsProjector();
	const metadata = $derived(
		withLiveContext(transcriptFactsProjector.project(envelopes).runtime, liveContext),
	);
	const contextPercent = $derived(metadata.context ? contextUsagePercent(metadata.context) : null);
	const pressure = $derived<ContextPressure>(
		metadata.context ? contextPressure(metadata.context) : 'ok',
	);
	const advice = $derived(metadata.context ? contextPressureAdvice(metadata.context) : null);
	const remainingTokens = $derived(
		metadata.context ? contextRemainingTokens(metadata.context) : null,
	);
	const breakdown = $derived(metadata.context ? contextBreakdown(metadata.context) : []);
	const planLimits = $derived(currentPlanLimits(planUsage, nowMs));
	const planAlert = $derived(planLimitAlert(planLimits));
	const signedIn = $derived(claudeCodeStatusQuery.data.kind === 'ready');
	const triggerLabel = $derived(
		[
			contextPercent === null
				? 'View context and plan usage'
				: `View context and plan usage, ${contextPercent.toFixed(0)}% of the context window used`,
			planAlert && `${planAlert.label} ${Math.round(planAlert.usedPercent)}% used`,
		]
			.filter(Boolean)
			.join(', '),
	);

	const GAUGE_RADIUS = 5.75;
	const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
	const gaugeDashOffset = $derived(GAUGE_CIRCUMFERENCE * (1 - (contextPercent ?? 0) / 100));
	const turnedOffMcpServers = $derived(turnedOffMcpServersQuery.data);
	const unhealthyMcpCount = $derived(
		needsYouCount(groupMcpServers(metadata.mcpServers ?? [], turnedOffMcpServers)),
	);

	onMount(loadTurnedOffMcpServersCommand);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 60_000);
		return () => clearInterval(clock);
	});

	function onContextOpenChange(next: boolean): void {
		contextOpen = next;
		if (!next) return;
		mcpOpen = false;
		nowMs = Date.now();
		if (sessionId) refreshSessionStatusCommand(sessionId);
	}

	function onMcpOpenChange(next: boolean): void {
		mcpOpen = next;
		if (!next) return;
		contextOpen = false;
		loadTurnedOffMcpServersCommand();
		if (sessionId) refreshSessionStatusCommand(sessionId);
	}

	function toneClass(level: ContextPressure): string {
		if (level === 'critical') return 'text-error-content';
		if (level === 'high') return 'text-warning-content';
		return 'text-fg-tertiary';
	}

	function fillClass(level: ContextPressure): string {
		if (level === 'critical') return 'bg-error-content';
		if (level === 'high') return 'bg-warning-content';
		return 'bg-primary';
	}

	const tokenFormat = new Intl.NumberFormat('en', {
		notation: 'compact',
		maximumFractionDigits: 1,
	});

	function formatTokens(value: number): string {
		return tokenFormat.format(value);
	}

	function formatShare(percent: number): string {
		return percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`;
	}

	function resetLabel(resetsAt: string, now: number): string {
		const minutes = Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 60_000));
		const days = Math.floor(minutes / 1_440);
		const hours = Math.floor((minutes % 1_440) / 60);
		const parts =
			days > 0
				? [`${days}d`, hours && `${hours}h`]
				: [hours && `${hours}h`, minutes % 60 && `${minutes % 60}m`];
		return `Resets in ${parts.filter(Boolean).join(' ')}`;
	}
</script>

{#snippet meter(label: string, percent: number, level: ContextPressure)}
	<div
		class="bg-surface-elevated-selected mt-2 h-1.5 overflow-hidden rounded-full"
		role="progressbar"
		aria-label={label}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(percent)}
	>
		<div class={['h-full rounded-full', fillClass(level)]} style={`width: ${percent}%`}></div>
	</div>
{/snippet}

{#snippet gauge()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		aria-hidden="true"
		class={['shrink-0 -rotate-90', toneClass(pressure)]}
		data-testid="session-context-usage-gauge"
		data-context-percent={contextPercent?.toFixed(1)}
		data-context-pressure={pressure}
	>
		<circle
			cx="8"
			cy="8"
			r={GAUGE_RADIUS}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class="opacity-25"
		/>
		{#if contextPercent}
			<circle
				cx="8"
				cy="8"
				r={GAUGE_RADIUS}
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-dasharray={GAUGE_CIRCUMFERENCE}
				stroke-dashoffset={gaugeDashOffset}
			/>
		{/if}
	</svg>
{/snippet}

<div class="flex items-center gap-0.5" data-testid="session-runtime-controls">
	<HoverCard
		bind:open={contextOpen}
		side="top"
		align="end"
		openDelay={160}
		closeDelay={140}
		triggerPress="ignore"
		onopenchange={onContextOpenChange}
		testId="session-context-hovercard"
		owner="chat-composer"
		panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-3"
	>
		{#snippet trigger({ open })}
			{#if planAlert}
				<Button
					variant="danger-ghost"
					size="md"
					pressable={false}
					class="gap-1.5 rounded-md text-xs font-normal"
					ariaLabel={triggerLabel}
					ariaExpanded={open}
					ariaControls="session-context-usage-panel"
					data-testid="session-context-usage-open"
				>
					{@render gauge()}
					<span class="tabular-nums" data-testid="session-plan-limit-alert">
						<span class="@max-2xl/composer:hidden">{planAlert.label} ·</span>
						{Math.round(planAlert.usedPercent)}% used
					</span>
				</Button>
			{:else}
				<IconButton
					variant="ghost"
					size="md"
					pressable={false}
					ariaLabel={triggerLabel}
					ariaExpanded={open}
					ariaControls="session-context-usage-panel"
					class="text-fg-tertiary"
					data-testid="session-context-usage-open"
				>
					{@render gauge()}
				</IconButton>
			{/if}
		{/snippet}

		{#snippet content()}
			<div
				id="session-context-usage-panel"
				role="dialog"
				tabindex="-1"
				aria-label="Context and plan usage"
				data-testid="session-context-usage-panel"
			>
				<div class="flex items-baseline justify-between gap-3">
					<h3 class="text-fg-default text-sm font-medium">Context</h3>
					{#if metadata.context}
						<span
							class="text-fg-tertiary text-xs tabular-nums"
							data-testid="session-context-usage-count"
						>
							{formatTokens(metadata.context.usedTokens)}
							{metadata.context.maxTokens
								? ` / ${formatTokens(metadata.context.maxTokens)}`
								: ' used'}
						</span>
					{/if}
				</div>

				{#if metadata.context}
					{#if contextPercent !== null}
						{@render meter('Context window used', contextPercent, pressure)}
						<div class="text-fg-tertiary mt-1.5 flex justify-between text-xs">
							<span class="tabular-nums">{contextPercent.toFixed(1)}% used</span>
							{#if remainingTokens !== null}
								<span class="tabular-nums" data-testid="session-context-usage-remaining">
									{formatTokens(remainingTokens)} left
								</span>
							{/if}
						</div>
						{#if advice}
							<p
								class={['mt-2 text-xs leading-5', toneClass(pressure)]}
								data-testid="session-context-usage-advice"
							>
								{advice}
							</p>
						{/if}
						{#if breakdown.length > 0}
							<dl
								class="border-border-subtle mt-3 space-y-1 border-t pt-3 text-xs"
								aria-label="Context window breakdown"
								data-testid="session-context-breakdown"
							>
								{#each breakdown as row (row.name)}
									<div
										class="flex items-baseline gap-3"
										data-testid="session-context-breakdown-row"
									>
										<dt
											class={[
												'min-w-0 flex-1 truncate',
												row.kind === 'used' ? 'text-fg-secondary' : 'text-fg-tertiary',
											]}
										>
											{row.name}
										</dt>
										<dd class="text-fg-tertiary tabular-nums">{formatTokens(row.tokens)}</dd>
										<dd class="text-fg-secondary w-12 text-right tabular-nums">
											{formatShare(row.percent)}
										</dd>
									</div>
								{/each}
							</dl>
						{/if}
					{:else}
						<p class="text-fg-tertiary mt-2 text-xs leading-5">
							{contextWindowUnknownMessage()}
						</p>
					{/if}
				{:else}
					<p class="text-fg-tertiary mt-2 text-xs leading-5">
						{contextUnavailableMessage()}
					</p>
				{/if}

				{#if planLimits.length > 0}
					<section
						class="border-border-subtle mt-3 border-t pt-3"
						aria-label="Plan usage"
						data-testid="session-plan-usage"
					>
						<h3 class="text-fg-default text-sm font-medium">Plan usage</h3>
						{#each planLimits as limit (limit.label)}
							{@const level = usagePressure(limit.usedPercent)}
							<div class="mt-2.5" data-testid="session-rate-limit-row">
								<div class="flex items-baseline justify-between gap-3 text-xs">
									<span class="text-fg-secondary">{limit.label}</span>
									<span
										class={['tabular-nums', level === 'ok' ? 'text-fg-default' : toneClass(level)]}
									>
										{Math.round(limit.usedPercent)}% used
									</span>
								</div>
								{@render meter(`${limit.label} used`, limit.usedPercent, level)}
								{#if limit.resetsAt}
									<p class="text-2xs text-fg-tertiary mt-1.5">
										{resetLabel(limit.resetsAt, nowMs)}
									</p>
								{/if}
							</div>
						{/each}
					</section>
				{/if}

				{#if signedIn}
					<section class="border-border-subtle mt-3 border-t pt-3" aria-label="Claude account">
						<div class="flex items-center justify-between gap-3">
							<h3 class="text-fg-default text-sm font-medium">Account</h3>
							<IconButton
								variant="ghost"
								size="xs"
								ariaLabel="Manage accounts"
								class="text-fg-tertiary"
								onclick={() => void goto(ACCOUNT_SETTINGS_HREF)}
							>
								<Icon name="settings" size={14} />
							</IconButton>
						</div>
						<ClaudeAccountList class="-mx-1.5 mt-1 -mb-1.5" />
					</section>
				{/if}
			</div>
		{/snippet}
	</HoverCard>

	<HoverCard
		bind:open={mcpOpen}
		side="top"
		align="start"
		openDelay={160}
		closeDelay={140}
		triggerPress="ignore"
		onopenchange={onMcpOpenChange}
		testId="session-mcp-hovercard"
		owner="chat-composer"
		panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-3"
	>
		{#snippet trigger({ open })}
			<IconButton
				variant="ghost"
				size="md"
				pressable={false}
				ariaLabel="View MCP server status"
				ariaExpanded={open}
				ariaControls="session-mcp-status-panel"
				class="text-fg-tertiary relative"
				data-testid="session-mcp-status-open"
			>
				<Icon name="plug" size={15} />
				{#if unhealthyMcpCount > 0}
					<span
						class="bg-error-content absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
						aria-hidden="true"
					></span>
				{/if}
			</IconButton>
		{/snippet}

		{#snippet content()}
			<div
				id="session-mcp-status-panel"
				role="dialog"
				tabindex="-1"
				aria-label="MCP server status"
				data-testid="session-mcp-status-panel"
			>
				<McpStatusPanel servers={metadata.mcpServers} {sessionId} {workstreamId} />
			</div>
		{/snippet}
	</HoverCard>
</div>
