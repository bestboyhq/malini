<script lang="ts">
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import { liveContextUsageQuery } from '$lib/chat/application/queries/live-context-usage.query.svelte';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
	import {
		contextPressure,
		contextPressureAdvice,
		contextRemainingTokens,
		contextUnavailableMessage,
		contextUsagePercent,
		contextWindowUnknownMessage,
		deriveSessionRuntimeMetadata,
		mcpUnavailableMessage,
		type ContextPressure,
		type McpServerSnapshot,
	} from './session-runtime-metadata';

	interface Props {
		envelopes: readonly EventEnvelope[];
		sessionId?: SessionId | null;
	}

	let { envelopes, sessionId = null }: Props = $props();
	let contextOpen = $state(false);
	let mcpOpen = $state(false);
	const liveContext = $derived(sessionId ? liveContextUsageQuery.data(sessionId) : null);
	const metadata = $derived(deriveSessionRuntimeMetadata(envelopes, liveContext));
	const contextPercent = $derived(metadata.context ? contextUsagePercent(metadata.context) : null);
	const pressure = $derived<ContextPressure>(
		metadata.context ? contextPressure(metadata.context) : 'ok',
	);
	const advice = $derived(metadata.context ? contextPressureAdvice(metadata.context) : null);
	const remainingTokens = $derived(
		metadata.context ? contextRemainingTokens(metadata.context) : null,
	);
	const pressureToneClass = $derived(
		pressure === 'critical'
			? 'text-error-content'
			: pressure === 'high'
				? 'text-warning-content'
				: 'text-fg-tertiary',
	);
	const triggerLabel = $derived(
		contextPercent === null
			? 'View context usage'
			: `View context usage, ${contextPercent.toFixed(0)}% of the window used`,
	);

	const GAUGE_RADIUS = 5.75;
	const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
	const gaugeDashOffset = $derived(GAUGE_CIRCUMFERENCE * (1 - (contextPercent ?? 0) / 100));
	const unhealthyMcpCount = $derived(
		metadata.mcpServers?.filter(
			(server) => server.status === 'failed' || server.status === 'needs-auth',
		).length ?? 0,
	);

	function onContextOpenChange(next: boolean): void {
		contextOpen = next;
		if (next) mcpOpen = false;
	}

	function onMcpOpenChange(next: boolean): void {
		mcpOpen = next;
		if (next) contextOpen = false;
	}

	function remainingPercent(utilization: number | null): number | null {
		return utilization === null ? null : Math.max(0, Math.min(100, 100 - utilization));
	}

	const contextTokenFormat = new Intl.NumberFormat('en', {
		notation: 'compact',
		maximumFractionDigits: 1,
	});

	function formatContextTokens(value: number): string {
		return contextTokenFormat.format(value);
	}

	function resetLabel(value: string | null): string | null {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		return date.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	function mcpStatusLabel(server: McpServerSnapshot): string {
		if (server.status === 'connected') return `${server.displayName} connected`;
		if (server.status === 'needs-auth') return `${server.displayName} needs authentication`;
		if (server.status === 'pending') return `${server.displayName} is connecting`;
		if (server.status === 'disabled') return `${server.displayName} is disabled`;
		const reason = sanitizeFailureDetail(server.error);
		return reason ? `${server.displayName} failed: ${reason}` : `${server.displayName} failed`;
	}
</script>

<div class="flex items-center gap-0.5" data-testid="session-runtime-controls">
	<HoverCard
		bind:open={contextOpen}
		side="top"
		align="start"
		openDelay={160}
		closeDelay={140}
		onopenchange={onContextOpenChange}
		testId="session-context-hovercard"
		backdropTestId="session-context-backdrop"
		owner="chat-composer"
		panelClass="w-72 rounded-lg border border-surface-elevated-border bg-surface-elevated p-3"
	>
		{#snippet trigger({ open })}
			<IconButton
				variant="ghost"
				size="md"
				ariaLabel={triggerLabel}
				ariaExpanded={open}
				ariaControls="session-context-usage-panel"
				class="text-fg-tertiary"
				data-testid="session-context-usage-open"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					aria-hidden="true"
					class={['-rotate-90', pressureToneClass]}
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
						stroke-width="1.5"
						class="opacity-25"
					/>
					{#if contextPercent}
						<circle
							cx="8"
							cy="8"
							r={GAUGE_RADIUS}
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-dasharray={GAUGE_CIRCUMFERENCE}
							stroke-dashoffset={gaugeDashOffset}
						/>
					{/if}
				</svg>
			</IconButton>
		{/snippet}

		{#snippet content()}
			<div
				id="session-context-usage-panel"
				role="dialog"
				tabindex="-1"
				aria-label="Context usage"
				data-testid="session-context-usage-panel"
			>
				<div class="flex items-baseline justify-between gap-3">
					<h3 class="text-fg-default text-sm font-medium">Context</h3>
					{#if metadata.context}
						<span
							class="text-fg-tertiary text-xs tabular-nums"
							data-testid="session-context-usage-count"
						>
							{formatContextTokens(metadata.context.usedTokens)}
							{metadata.context.maxTokens
								? ` / ${formatContextTokens(metadata.context.maxTokens)}`
								: ' used'}
						</span>
					{/if}
				</div>

				{#if metadata.context}
					{#if contextPercent !== null}
						<div
							class="bg-chip mt-3 h-2 overflow-hidden rounded-full"
							role="progressbar"
							aria-label="Context window used"
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={Math.round(contextPercent)}
						>
							<div
								class={[
									'h-full rounded-full',
									pressure === 'critical'
										? 'bg-error-content'
										: pressure === 'high'
											? 'bg-warning-content'
											: 'bg-primary',
								]}
								style={`width: ${contextPercent}%`}
							></div>
						</div>
						<div class="text-fg-tertiary mt-1.5 flex justify-between text-xs">
							<span class="tabular-nums">{contextPercent.toFixed(1)}% used</span>
							{#if remainingTokens !== null}
								<span class="tabular-nums" data-testid="session-context-usage-remaining">
									{formatContextTokens(remainingTokens)} left
								</span>
							{/if}
						</div>
						{#if advice}
							<p
								class={[
									'mt-2 text-xs leading-5',
									pressure === 'critical' ? 'text-error-content' : 'text-warning-content',
								]}
								data-testid="session-context-usage-advice"
							>
								{advice}
							</p>
						{/if}
					{:else}
						<p class="text-fg-tertiary mt-2 text-xs leading-5">
							{contextWindowUnknownMessage()}
						</p>
					{/if}

					{#each metadata.context.rateLimits as limit (limit.label)}
						{@const remaining = remainingPercent(limit.utilization)}
						<div
							class="border-border-subtle mt-3 border-t pt-3"
							data-testid="session-rate-limit-row"
						>
							<div class="flex items-center justify-between gap-3 text-xs">
								<span class="text-fg-tertiary">{limit.label}</span>
								<span class="text-fg-default font-medium tabular-nums">
									{remaining === null ? 'Unavailable' : `${Math.round(remaining)}% left`}
								</span>
							</div>
							{#if remaining !== null}
								<div
									class="bg-chip mt-2 h-1.5 overflow-hidden rounded-full"
									role="progressbar"
									aria-label={`${limit.label} remaining`}
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={Math.round(remaining)}
								>
									<div class="bg-primary h-full rounded-full" style={`width: ${remaining}%`}></div>
								</div>
							{/if}
							{#if resetLabel(limit.resetsAt)}
								<p class="text-2xs text-fg-tertiary mt-1.5">Resets {resetLabel(limit.resetsAt)}</p>
							{/if}
						</div>
					{/each}
				{:else}
					<p class="text-fg-tertiary mt-2 text-xs leading-5">
						{contextUnavailableMessage()}
					</p>
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
		onopenchange={onMcpOpenChange}
		testId="session-mcp-hovercard"
		backdropTestId="session-mcp-backdrop"
		owner="chat-composer"
		panelClass="w-72 rounded-lg border border-surface-elevated-border bg-surface-elevated p-3"
	>
		{#snippet trigger({ open })}
			<IconButton
				variant="ghost"
				size="md"
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
				<h3 class="text-fg-default text-sm font-medium">MCPs</h3>
				{#if metadata.mcpServers === null}
					<p class="text-fg-tertiary mt-2 text-xs leading-5">{mcpUnavailableMessage()}</p>
				{:else if metadata.mcpServers.length === 0}
					<p class="text-fg-secondary mt-2 text-xs leading-5">No MCP servers configured</p>
					<p class="text-2xs text-fg-tertiary mt-0.5 leading-5">
						MCP servers give the agent extra tools. Declare them in this repository's MCP config and
						the agent picks them up on the next run.
					</p>
				{:else}
					<ul class="mt-2 space-y-0.5">
						{#each metadata.mcpServers as server (server.name)}
							<li
								class="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 text-xs"
								data-testid="session-mcp-status-row"
								data-mcp-server-id={server.name}
								data-mcp-usable={server.usable ? 'true' : 'false'}
							>
								<span
									class={[
										'mt-0.5 shrink-0',
										server.status === 'connected'
											? 'text-success-content'
											: server.status === 'failed' || server.status === 'needs-auth'
												? 'text-error-content'
												: 'text-fg-tertiary',
									]}
								>
									{#if server.status === 'connected'}
										<Icon name="check" size={14} />
									{:else if server.status === 'pending'}
										<LoadingCircle size={14} />
									{:else if server.status === 'failed' || server.status === 'needs-auth'}
										<Icon name="alert" size={14} />
									{:else}
										<Icon name="circle" size={14} />
									{/if}
								</span>
								<div class="min-w-0 flex-1">
									<Tooltip
										content={`MCP server ID: ${server.name}`}
										placement="top"
										class="min-w-0"
									>
										<p
											class="text-fg-default truncate font-medium"
											data-testid="session-mcp-display-name"
										>
											{server.displayName}
										</p>
									</Tooltip>
									{#if server.status !== 'connected'}
										<p class="text-2xs text-fg-tertiary mt-0.5 leading-4 break-words">
											{mcpStatusLabel(server)}
										</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/snippet}
	</HoverCard>
</div>
