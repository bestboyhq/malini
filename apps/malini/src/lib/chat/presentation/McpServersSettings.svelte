<script lang="ts">
	import { onMount } from 'svelte';
	import {
		groupMcpServers,
		isTurnedOff,
		mcpFixSteps,
		mcpServerFix,
		mcpServerSections,
		type McpServer,
		type McpServerFix,
	} from '$lib/chat/domain/mcp-server';
	import { authorizeMcpServerCommand } from '$lib/chat/application/commands/authorize-mcp-server.command';
	import { watchMcpServersCommand } from '$lib/chat/application/commands/watch-mcp-servers.command';
	import { keepMcpServersWatchedHook } from '$lib/chat/application/hooks/keep-mcp-servers-watched.hook';
	import { openClaudeAiConnectorsCommand } from '$lib/chat/application/commands/open-claude-ai-connectors.command';
	import { openMcpFixQueueCommand } from '$lib/chat/application/commands/open-mcp-fix-queue.command';
	import { reconnectMcpServerCommand } from '$lib/chat/application/commands/reconnect-mcp-server.command';
	import { switchMcpServerCommand } from '$lib/chat/application/commands/switch-mcp-server.command';
	import { mcpServerBusyQuery } from '$lib/chat/application/queries/mcp-server-busy.query.svelte';
	import { mcpServerListingQuery } from '$lib/chat/application/queries/mcp-server-listing.query.svelte';
	import { turnedOffMcpServersQuery } from '$lib/chat/application/queries/turned-off-mcp-servers.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Switch } from '$hyper-ui/components/switch';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
	import StateBlock from '$shared/errors/StateBlock.svelte';

	type Filter = 'all' | 'needs-you' | 'off';

	interface Props {
		workstreamId: string | null;
	}

	let { workstreamId }: Props = $props();
	let filter: Filter = $state('all');
	let search = $state('');

	const listing = $derived(mcpServerListingQuery.data(workstreamId));
	const turnedOff = $derived(turnedOffMcpServersQuery.data);
	const busy = $derived(mcpServerBusyQuery.data);
	const servers = $derived(listing.servers);
	const groups = $derived(groupMcpServers(servers, turnedOff));
	const steps = $derived(mcpFixSteps(groups));
	const needsYou = $derived(
		new Set(
			[...groups.signIn, ...groups.claudeAi, ...groups.failed, ...groups.duplicates].map(
				({ name }) => name,
			),
		),
	);
	const shown = $derived(
		servers.filter((server) => matchesFilter(server) && matchesSearch(server, search)),
	);
	const sections = $derived(mcpServerSections(shown, null));
	const target = $derived({ workstreamId });
	const loading = $derived(
		listing.state !== 'error' && listing.state !== 'ready' && servers.length === 0,
	);
	const refreshing = $derived(listing.state === 'loading' && servers.length > 0);
	const listId = $props.id();

	onMount(() => keepMcpServersWatchedHook(workstreamId));

	function matchesFilter(server: McpServer): boolean {
		if (filter === 'needs-you') return needsYou.has(server.name);
		if (filter === 'off') return isTurnedOff(server, turnedOff);
		return true;
	}

	function matchesSearch(server: McpServer, text: string): boolean {
		const query = text.trim().toLowerCase();
		if (!query) return true;
		return (
			server.displayName.toLowerCase().includes(query) || server.name.toLowerCase().includes(query)
		);
	}

	function statusLine(server: McpServer, fix: McpServerFix | null, off: boolean): string {
		if (off) {
			return server.status === 'disabled' && !turnedOff.includes(server.name)
				? 'Off in Claude Code for this folder'
				: 'Off';
		}
		if (fix === 'duplicate') return 'A connected server with the same name covers it.';
		if (server.status === 'needs-auth') return 'Not signed in';
		if (server.status === 'pending') return 'Connecting';
		if (server.status === 'failed') {
			const detail = sanitizeFailureDetail(server.error) || 'Could not connect';
			return fix === 'reconnect-on-claude-ai' ? `${detail}. Reconnect it on claude.ai.` : detail;
		}
		if (server.toolCount === null) return 'Connected';
		return server.toolCount === 1 ? '1 tool' : `${server.toolCount} tools`;
	}

	function onFix(): void {
		openMcpFixQueueCommand(workstreamId, steps);
	}

	function filterLabel(value: Filter): string {
		if (value === 'needs-you') return 'Needs you';
		if (value === 'off') return 'Off';
		return 'All';
	}

	function filterCount(value: Filter): number {
		if (value === 'needs-you') return needsYou.size;
		if (value === 'off') return groups.off.length;
		return servers.length;
	}
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<div class="flex h-8 items-center gap-2 px-1.5">
		<div class="bg-surface-50 flex shrink-0 rounded-lg p-0.5" role="group" aria-label="Show">
			{#each ['all', 'needs-you', 'off'] as const as value (value)}
				<Button
					bare
					class={[
						'flex h-6 cursor-pointer items-center gap-1 rounded-md px-2.5 text-xs',
						filter === value
							? 'bg-surface-50-selected text-fg-default'
							: 'text-fg-tertiary hover:text-fg-secondary',
					]}
					ariaPressed={filter === value}
					onclick={() => (filter = value)}
				>
					{filterLabel(value)}
					<span
						class={[
							'tabular-nums',
							value === 'needs-you' && filterCount(value) > 0 ? 'text-error-content' : null,
						]}
					>
						{filterCount(value)}
					</span>
				</Button>
			{/each}
		</div>
		<TextInput
			bind:value={search}
			size="xs"
			placeholder="Filter"
			ariaLabel="Filter MCP servers"
			class="min-w-0 flex-1"
		>
			{#snippet icon()}
				<Icon name="search" size={12} />
			{/snippet}
		</TextInput>
		<IconButton
			variant="ghost"
			size="md"
			ariaLabel="Check MCP servers again"
			class="text-fg-tertiary shrink-0"
			disabled={listing.state === 'loading'}
			onclick={() => watchMcpServersCommand(workstreamId, true)}
		>
			{#if refreshing}
				<LoadingCircle size={14} />
			{:else}
				<Icon name="refresh" size={14} />
			{/if}
		</IconButton>
		{#if steps.length > 0}
			<Button
				variant="primary"
				size="md"
				class="shrink-0"
				ariaLabel={`Fix ${steps.length} MCP ${steps.length === 1 ? 'server' : 'servers'}`}
				onclick={onFix}
			>
				Fix {steps.length}
			</Button>
		{/if}
	</div>

	{#if listing.state === 'error' && servers.length === 0}
		<StateBlock
			heading="Could not read your MCP servers"
			detail={listing.error}
			remedy="Malini starts Claude Code with your settings and asks it for every MCP server it connects."
			tone="critical"
			testId="mcp-servers-error"
		>
			{#snippet action()}
				<Button
					variant="secondary"
					size="sm"
					onclick={() => watchMcpServersCommand(workstreamId, true)}
				>
					Try again
				</Button>
			{/snippet}
		</StateBlock>
	{:else if loading}
		<p class="text-fg-tertiary px-3 text-xs">
			Claude Code connects every server to check it. This takes a few seconds.
		</p>
		<div class="flex flex-col gap-1 px-1.5 pb-1.5" aria-label="Loading MCP servers">
			{#each [0, 1, 2, 3, 4] as row (row)}
				<Skeleton height="44px" class="rounded-xl" />
			{/each}
		</div>
	{:else if sections.length === 0}
		<p class="text-fg-tertiary px-3 py-6 text-center text-xs">
			{search.trim()
				? `No MCP server matches “${search.trim()}”.`
				: filter === 'needs-you'
					? 'Every MCP server is fine.'
					: filter === 'off'
						? 'No MCP server is off.'
						: 'Claude Code found no MCP servers.'}
		</p>
	{:else}
		{#each sections as section (section.key)}
			<section
				class="bg-surface-root flex min-w-0 flex-col gap-1 rounded-[18px] p-1.5"
				aria-label={section.label}
			>
				<header class="flex h-8 items-center gap-2 pr-0.5 pl-3">
					<h3 class="text-fg-default truncate text-xs font-medium">{section.label}</h3>
					{#if section.detail}
						<span class="text-fg-tertiary text-3xs truncate font-mono">{section.detail}</span>
					{/if}
					<span class="flex-1"></span>
					{#if section.key === 'claude-ai'}
						<Button
							variant="secondary"
							size="xs"
							ariaLabel="Open claude.ai connectors"
							onclick={openClaudeAiConnectorsCommand}
						>
							claude.ai
							{#snippet trailing()}
								<Icon name="external-link" size={12} />
							{/snippet}
						</Button>
					{/if}
				</header>
				<ul
					class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
					aria-label={`${section.label} servers`}
				>
					{#each section.servers as server, position (server.name)}
						{@const off = isTurnedOff(server, turnedOff)}
						{@const fix = off ? null : mcpServerFix(server, servers)}
						{@const labelId = `${listId}-${section.key}-${position}`}
						{@const working = busy(target, server.name)}
						<li
							class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5 pr-3 pl-3.5"
							aria-labelledby={labelId}
							data-testid="mcp-server-row"
							data-mcp-server-id={server.name}
							data-mcp-status={off ? 'off' : server.status}
						>
							{#if off}
								<Icon name="circle-slash" size={14} class="text-fg-tertiary" />
							{:else if server.status === 'connected'}
								<Icon name="check" size={14} class="text-success-content" />
							{:else if server.status === 'pending'}
								<LoadingCircle size={14} />
							{:else if fix === 'duplicate'}
								<Icon name="copy" size={14} class="text-warning-content" />
							{:else}
								<Icon name="alert" size={14} class="text-error-content" />
							{/if}
							<div class="min-w-0">
								<div class="flex min-w-0 items-baseline gap-2">
									<h4
										id={labelId}
										class={[
											'truncate text-sm font-medium',
											off ? 'text-fg-tertiary' : 'text-fg-default',
										]}
									>
										{server.displayName}
									</h4>
									<span class="text-fg-tertiary text-3xs shrink-0 truncate font-mono">
										{server.name}
									</span>
								</div>
								<p
									class={[
										'line-clamp-2 text-xs break-words',
										!off && server.status === 'failed' && fix !== 'duplicate'
											? 'text-error-content'
											: 'text-fg-tertiary',
									]}
								>
									{statusLine(server, fix, off)}
								</p>
							</div>
							<div class="flex justify-end">
								{#if fix === 'sign-in'}
									<Button
										variant="secondary"
										size="xs"
										loading={working}
										ariaLabel={`Sign in to ${server.displayName}`}
										onclick={() =>
											authorizeMcpServerCommand(target, server.name, server.displayName)}
									>
										Sign in
									</Button>
								{:else if fix === 'retry' || fix === 'reconnect-on-claude-ai'}
									<Button
										variant={fix === 'retry' ? 'secondary' : 'ghost'}
										size="xs"
										loading={working}
										ariaLabel={`Retry ${server.displayName}`}
										onclick={() =>
											reconnectMcpServerCommand(target, server.name, server.displayName)}
									>
										Retry
									</Button>
								{/if}
							</div>
							<Switch
								checked={!off}
								disabled={server.status === 'disabled' && !turnedOff.includes(server.name)}
								ariaLabel={`MCP server ${server.displayName}`}
								onchange={(on) => switchMcpServerCommand([server.name], server.displayName, on)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>
