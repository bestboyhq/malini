<script lang="ts">
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import {
		currentPlanLimits,
		highestPlanLimit,
		lastRunAccount,
		planLimitAlert,
		type PlanLimit,
	} from '$lib/chat/domain/plan-usage';
	import { liveContextUsageQuery } from '$lib/chat/application/queries/live-context-usage.query.svelte';
	import { planUsageQuery } from '$lib/chat/application/queries/plan-usage.query.svelte';
	import { refreshSessionStatusCommand } from '$lib/chat/application/commands/refresh-session-status.command';
	import { loadTurnedOffMcpServersCommand } from '$lib/chat/application/commands/load-turned-off-mcp-servers.command';
	import { loadPlanUsageCommand } from '$lib/chat/application/commands/load-plan-usage.command';
	import { turnedOffMcpServersQuery } from '$lib/chat/application/queries/turned-off-mcp-servers.query.svelte';
	import { groupMcpServers, needsYouCount } from '$lib/chat/domain/mcp-server';
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import {
		CHATGPT_PROVIDER_ID,
		CHATGPT_USAGE_URL,
		CLAUDE_PROVIDER_ID,
		OPENCODE_PROVIDER_ID,
		ClaudeAccountList,
		claudeCodeStatusQuery,
		ProviderIcon,
		opencodeUsageQuery,
		otherClaudeAccountsQuery,
		providerGroupFor,
		providerGroupsQuery,
		reloadModelProvidersCommand,
		subscriptionBillingQuery,
		type ProviderGroup,
	} from '$shared/providers/providers.api';
	import { goto } from '$shared/router/navigation';
	import { PROVIDER_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import {
		contextBreakdown,
		contextPressure,
		contextPressureAdvice,
		contextRemainingTokens,
		contextUnavailableMessage,
		contextUsagePercent,
		contextWindowUnknownMessage,
		formatRunUsage,
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
		provider?: string | null;
		disabled?: boolean;
	}

	interface UsageRow {
		key: string;
		providerId: string;
		name: string;
		account: string | null;
		current: boolean;
		limit: PlanLimit | null;
		note: string | null;
		warn: boolean;
	}

	let {
		envelopes,
		sessionId = null,
		workstreamId = null,
		provider = null,
		disabled = false,
	}: Props = $props();
	let contextOpen = $state(false);
	let mcpOpen = $state(false);
	let nowMs = $state(Date.now());
	const liveContext = $derived(sessionId ? liveContextUsageQuery.data(sessionId) : null);
	const planUsage = $derived(planUsageQuery.data);
	const transcriptFactsProjector = new TranscriptFactsProjector();
	const transcriptFacts = $derived(transcriptFactsProjector.project(envelopes));
	const metadata = $derived(withLiveContext(transcriptFacts.runtime, liveContext));
	const runUsage = $derived(transcriptFacts.lastRunUsage);
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
	const groups = $derived(providerGroupsQuery.data);
	const claudeStatus = $derived(claudeCodeStatusQuery.data);
	const signedIn = $derived(claudeStatus.kind === 'ready');
	const claudeAccount = $derived(claudeStatus.kind === 'ready' ? claudeStatus.account : null);
	const leadId = $derived(provider ?? CLAUDE_PROVIDER_ID);
	const lead = $derived(providerGroupFor(groups, leadId));
	const leadReady = $derived(leadId === CLAUDE_PROVIDER_ID ? signedIn : lead?.ready === true);
	const opencodeReady = $derived(providerGroupFor(groups, OPENCODE_PROVIDER_ID)?.ready === true);
	const opencodeLimits = $derived(
		opencodeReady ? currentPlanLimits(opencodeUsageQuery.data, nowMs) : [],
	);
	const leadLimits = $derived(
		leadId === CLAUDE_PROVIDER_ID
			? planLimits
			: leadId === OPENCODE_PROVIDER_ID
				? opencodeLimits
				: [],
	);
	const planAlert = $derived(planLimitAlert(leadLimits));
	const otherRows = $derived.by((): readonly UsageRow[] => {
		const accounts =
			signedIn && leadId !== CLAUDE_PROVIDER_ID
				? [claudeAccount?.email ?? null, ...otherClaudeAccountsQuery.data]
				: [];
		const claudeRows = accounts.map((email, index): UsageRow => ({
			key: `claude:${email ?? ''}`,
			providerId: CLAUDE_PROVIDER_ID,
			name: 'Claude',
			account: accounts.length > 1 ? email : null,
			current: accounts.length > 1 && index === 0,
			limit: highestPlanLimit(currentPlanLimits(planUsageQuery.of(email), nowMs)),
			note: index === 0 ? (claudeAccount?.plan ?? null) : null,
			warn: false,
		}));
		const providerRows = groups
			.filter((group) => group.kind !== 'claude' && group.id !== leadId && group.ready)
			.map((group): UsageRow => ({
				key: group.id,
				providerId: group.id,
				name: group.name,
				account: null,
				current: false,
				limit: group.id === OPENCODE_PROVIDER_ID ? highestPlanLimit(opencodeLimits) : null,
				note: group.kind === 'chatgpt' ? chatGptNote(group) : keyNote(group),
				warn: Boolean(group.account?.usageLimitReachedAt),
			}));
		return [...claudeRows, ...providerRows];
	});
	const showsRunCost = $derived(provider !== CHATGPT_PROVIDER_ID && !subscriptionBillingQuery.data);
	const chatAccount = $derived(lastRunAccount(envelopes));
	const ranOnOtherAccount = $derived(
		claudeStatus.kind === 'ready' &&
			chatAccount !== null &&
			claudeStatus.account?.email !== undefined &&
			chatAccount !== claudeStatus.account.email,
	);
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

	onMount(() => {
		loadTurnedOffMcpServersCommand();
		loadPlanUsageCommand();
	});

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 60_000);
		return () => clearInterval(clock);
	});

	$effect(() => {
		if (leadId === OPENCODE_PROVIDER_ID && opencodeReady) void opencodeUsageQuery.load();
	});

	function onContextOpenChange(next: boolean): void {
		contextOpen = next;
		if (!next) return;
		mcpOpen = false;
		nowMs = Date.now();
		reloadModelProvidersCommand();
		loadPlanUsageCommand();
		if (opencodeReady) void opencodeUsageQuery.load();
		if (sessionId) refreshSessionStatusCommand(sessionId);
	}

	function chatGptNote(group: ProviderGroup): string {
		return group.account?.usageLimitReachedAt ? 'Usage limit hit' : 'ChatGPT plan';
	}

	function keyNote(group: ProviderGroup): string {
		return group.plan === 'go' ? 'Go plan' : 'API key';
	}

	function shortLimitLabel(limit: PlanLimit): string {
		return limit.label.replace(/ limit$/u, '');
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

{#snippet meter(label: string, percent: number, level: ContextPressure, spacing = 'mt-2')}
	<div
		class={['bg-surface-elevated-selected h-1 overflow-hidden rounded-full', spacing]}
		role="progressbar"
		aria-label={label}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(percent)}
	>
		<div class={['h-full rounded-full', fillClass(level)]} style={`width: ${percent}%`}></div>
	</div>
{/snippet}

{#snippet planUsageRows()}
	{#if planLimits.length > 0}
		<ul class="pb-1" aria-label="Plan usage" data-testid="session-plan-usage">
			{#each planLimits as limit (limit.label)}
				{@render limitRow(limit)}
			{/each}
		</ul>
	{:else if claudeStatus.kind === 'ready' && claudeStatus.account?.plan}
		<p class="text-2xs text-fg-tertiary pb-1 leading-4">
			Usage limits show after this account's next run.
		</p>
	{/if}
{/snippet}

{#snippet limitRow(limit: PlanLimit)}
	{@const level = usagePressure(limit.usedPercent)}
	<li class="mt-2.5 first:mt-2" data-testid="session-rate-limit-row">
		<div class="flex items-baseline gap-2 text-xs">
			<span class="text-fg-secondary shrink-0">{limit.label}</span>
			<span class="text-2xs text-fg-tertiary min-w-0 flex-1 truncate">
				{limit.resetsAt ? resetLabel(limit.resetsAt, nowMs) : ''}
			</span>
			<span
				class={['shrink-0 tabular-nums', level === 'ok' ? 'text-fg-default' : toneClass(level)]}
			>
				{Math.round(limit.usedPercent)}% used
			</span>
		</div>
		{@render meter(`${limit.label} used`, limit.usedPercent, level, 'mt-1.5')}
	</li>
{/snippet}

{#snippet limitSummary(limit: PlanLimit)}
	{@const level = usagePressure(limit.usedPercent)}
	<span
		class={[
			'text-2xs shrink-0 tabular-nums',
			level === 'ok' ? 'text-fg-secondary' : toneClass(level),
		]}
	>
		{shortLimitLabel(limit)} · {Math.round(limit.usedPercent)}%
	</span>
{/snippet}

{#snippet otherAccountUsage(email: string)}
	{@const limit = highestPlanLimit(currentPlanLimits(planUsageQuery.of(email), nowMs))}
	{#if limit}
		{@render limitSummary(limit)}
	{/if}
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
		panelClass="w-84 rounded-[18px] border-[0.5px] border-surface-elevated-border bg-surface-root p-1.5"
	>
		{#snippet trigger({ open })}
			{#if planAlert}
				<Button
					variant="danger-ghost"
					size="md"
					pressable={false}
					{disabled}
					class="gap-1.5 rounded-md text-xs font-normal"
					ariaLabel={triggerLabel}
					ariaExpanded={open}
					ariaControls="session-context-usage-panel"
					data-testid="session-context-usage-open"
				>
					{@render gauge()}
					<span class="tabular-nums" data-testid="session-plan-limit-alert">
						{Math.round(planAlert.usedPercent)}% used
					</span>
				</Button>
			{:else}
				<IconButton
					variant="ghost"
					size="md"
					pressable={false}
					{disabled}
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
				class="flex flex-col gap-1.5"
			>
				<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-2.5">
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
									class="border-surface-50-border mt-3 space-y-1 border-t-[0.5px] pt-3 text-xs"
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

					{#if runUsage}
						<section
							class="border-surface-50-border mt-3 flex items-baseline justify-between gap-3 border-t-[0.5px] pt-3 text-xs"
							aria-label="Last run"
							data-testid="session-run-usage"
						>
							<h3 class="text-fg-default text-sm font-medium">Last run</h3>
							<span class="text-fg-tertiary tabular-nums">
								{formatRunUsage(runUsage, showsRunCost)}
							</span>
						</section>
					{/if}
				</div>

				{#if lead && leadReady}
					<section
						class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-2.5"
						aria-label={lead.name}
					>
						<div class="flex items-center gap-2">
							<ProviderIcon providerId={lead.id} size={14} class="text-fg-secondary shrink-0" />
							<h3 class="text-fg-default text-sm font-medium">{lead.name}</h3>
							<span class="text-2xs text-fg-tertiary min-w-0 flex-1 truncate">
								{lead.kind === 'anthropic' ? keyNote(lead) : ''}
							</span>
							<IconButton
								variant="ghost"
								size="xs"
								ariaLabel="Manage providers"
								class="text-fg-tertiary"
								onclick={() => void goto(PROVIDER_SETTINGS_HREF)}
							>
								<Icon name="settings" size={14} />
							</IconButton>
						</div>
						{#if lead.kind === 'claude'}
							{#if ranOnOtherAccount && chatAccount}
								<p class="text-2xs text-fg-tertiary mt-1 leading-4">
									This chat last ran on <SensitiveText text={chatAccount} />. Its next prompt uses
									the checked account.
								</p>
							{/if}
							<ClaudeAccountList class="-mx-1.5 mt-1 -mb-1.5">
								{#snippet current()}
									{@render planUsageRows()}
								{/snippet}
								{#snippet other(email)}
									{@render otherAccountUsage(email)}
								{/snippet}
							</ClaudeAccountList>
						{:else if lead.kind === 'chatgpt'}
							<div class="mt-1 py-1 text-xs">
								<div class="flex min-h-6 min-w-0 items-center gap-2">
									<Icon name="check" size={14} class="text-success-content shrink-0" />
									<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
										{#if lead.account?.email}
											<SensitiveText text={lead.account.email} />
										{:else}
											Signed in
										{/if}
									</span>
									<a
										href={CHATGPT_USAGE_URL}
										target="_blank"
										rel="noreferrer"
										class="text-2xs text-fg-tertiary hover:text-fg-secondary shrink-0 underline-offset-2 hover:underline"
									>
										Manage usage
									</a>
								</div>
								<p
									class={[
										'text-2xs pl-5.5 leading-4',
										lead.account?.usageLimitReachedAt ? 'text-warning-content' : 'text-fg-tertiary',
									]}
								>
									{lead.account?.usageLimitReachedAt
										? 'You hit your ChatGPT usage limit.'
										: 'Using ChatGPT plan'}
								</p>
							</div>
						{:else if lead.id === OPENCODE_PROVIDER_ID && opencodeLimits.length > 0}
							<ul aria-label={`${lead.name} usage`} data-testid="session-opencode-usage">
								{#each opencodeLimits as limit (limit.label)}
									{@render limitRow(limit)}
								{/each}
							</ul>
						{:else if lead.plan === 'go'}
							<p class="text-2xs text-fg-tertiary mt-1 leading-4">
								Usage limits show once OpenCode reports them.
							</p>
						{/if}
					</section>
				{/if}

				{#if otherRows.length > 0}
					<ul
						class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-1.5"
						aria-label="Other providers"
					>
						{#each otherRows as row (row.key)}
							<li
								class="text-2xs flex h-6 min-w-0 items-center gap-2"
								aria-current={row.current ? 'true' : undefined}
							>
								<ProviderIcon
									providerId={row.providerId}
									size={12}
									class="text-fg-tertiary shrink-0"
								/>
								<span class="text-fg-secondary shrink-0">{row.name}</span>
								<span
									class={[
										'flex min-w-0 flex-1 items-center gap-1',
										row.current ? 'text-fg-secondary' : 'text-fg-tertiary',
									]}
								>
									{#if row.current}
										<Icon name="check" size={12} class="text-success-content shrink-0" />
									{:else if row.account}
										<span class="w-3 shrink-0" aria-hidden="true"></span>
									{/if}
									{#if row.account}
										<span class="min-w-0 truncate"><SensitiveText text={row.account} /></span>
									{/if}
								</span>
								{#if row.limit}
									{@render limitSummary(row.limit)}
								{:else if row.note}
									<span
										class={['shrink-0', row.warn ? 'text-warning-content' : 'text-fg-tertiary']}
									>
										{row.note}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
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
				{disabled}
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
