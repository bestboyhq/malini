<script lang="ts">
	import type { SessionId } from '$lib/chat/domain/session';
	import {
		groupMcpServers,
		mcpFixSteps,
		mcpServerFix,
		sharesDisplayName,
		withTurnedOffListed,
		type McpServer,
	} from '$lib/chat/domain/mcp-server';
	import { openClaudeAiConnectorsCommand } from '$lib/chat/application/commands/open-claude-ai-connectors.command';
	import { openMcpFixQueueCommand } from '$lib/chat/application/commands/open-mcp-fix-queue.command';
	import { switchMcpServerCommand } from '$lib/chat/application/commands/switch-mcp-server.command';
	import { turnedOffMcpServersQuery } from '$lib/chat/application/queries/turned-off-mcp-servers.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { goto } from '$shared/router/navigation';
	import { MCP_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import McpServerRow from './McpServerRow.svelte';
	import { mcpUnavailableMessage } from './session-runtime-metadata';

	interface Props {
		servers: readonly McpServer[] | null;
		sessionId: SessionId | null;
		workstreamId: string | null;
	}

	const SIGN_IN_PREVIEW = 3;

	let { servers, sessionId, workstreamId }: Props = $props();
	let signInExpanded = $state(false);
	let readyChoice: boolean | null = $state(null);
	let offExpanded = $state(false);

	const turnedOff = $derived(turnedOffMcpServersQuery.data);
	const listed = $derived(servers === null ? [] : withTurnedOffListed(servers, turnedOff));
	const groups = $derived(groupMcpServers(listed, turnedOff));
	const steps = $derived(mcpFixSteps(groups));
	const onCount = $derived(listed.length - groups.off.length);
	const settled = $derived(
		steps.length === 0 && groups.duplicates.length === 0 && groups.connecting.length === 0,
	);
	const readyOpen = $derived(readyChoice ?? settled);
	const target = $derived(sessionId ? { sessionId } : null);
	const hiddenSignIns = $derived(
		signInExpanded ? [] : groups.signIn.slice(SIGN_IN_PREVIEW).map((server) => server.displayName),
	);

	function onFix(): void {
		openMcpFixQueueCommand(workstreamId, steps);
	}

	function onManage(): void {
		void goto(MCP_SETTINGS_HREF);
	}

	function onTurnOffDuplicates(): void {
		switchMcpServerCommand(
			groups.duplicates.map(({ name }) => name),
			groups.duplicates.length === 1 ? (groups.duplicates[0]?.displayName ?? '') : 'the duplicates',
			false,
		);
	}

	function moreLabel(names: readonly string[]): string {
		const shown = names.slice(0, 2).join(', ');
		return names.length > 2 ? `${shown} and ${names.length - 2} more` : shown;
	}
</script>

{#snippet heading(icon: IconName, tone: string, title: string, count: number)}
	<Icon name={icon} size={14} class={['shrink-0', tone]} />
	<h4 class="text-fg-default min-w-0 flex-1 truncate text-xs font-medium">
		{title}
		<span class="text-fg-tertiary font-normal tabular-nums">· {count}</span>
	</h4>
{/snippet}

{#snippet rows(list: readonly McpServer[], off: boolean)}
	<ul class="space-y-px">
		{#each list as server (server.name)}
			<McpServerRow
				{server}
				{off}
				{target}
				fix={off ? null : mcpServerFix(server, listed)}
				showOrigin={sharesDisplayName(server, listed)}
			/>
		{/each}
	</ul>
{/snippet}

{#snippet toggle(
	label: string,
	count: number,
	icon: IconName,
	tone: string,
	open: boolean,
	onclick: () => void,
)}
	<Button
		bare
		class="hover:bg-surface-elevated-hover flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left"
		ariaExpanded={open}
		{onclick}
	>
		{@render heading(icon, tone, label, count)}
		<Icon
			name={open ? 'chevron-down' : 'chevron-right'}
			size={14}
			class="text-fg-tertiary shrink-0"
		/>
	</Button>
{/snippet}

<header class="flex items-center gap-2 pb-1">
	<h3 class="text-fg-default text-sm font-medium">MCPs</h3>
	{#if onCount > 0}
		<span class="text-fg-tertiary text-xs tabular-nums" data-testid="session-mcp-ready-count">
			{groups.ready.length} of {onCount} ready
		</span>
	{/if}
	<span class="flex-1"></span>
	{#if steps.length > 0}
		<Button
			variant="primary"
			size="xs"
			ariaLabel={`Fix ${steps.length} MCP ${steps.length === 1 ? 'server' : 'servers'}`}
			onclick={onFix}
			data-testid="session-mcp-fix"
		>
			Fix {steps.length}
		</Button>
	{/if}
	<IconButton
		variant="ghost"
		size="xs"
		ariaLabel="Manage MCP servers"
		class="text-fg-tertiary"
		onclick={onManage}
	>
		<Icon name="settings" size={14} />
	</IconButton>
</header>

{#if servers === null}
	<p class="text-fg-tertiary mt-1 text-xs leading-5">{mcpUnavailableMessage()}</p>
{:else if listed.length === 0}
	<p class="text-fg-secondary mt-1 text-xs leading-5">No MCP servers configured</p>
	<p class="text-2xs text-fg-tertiary mt-0.5 leading-5">
		MCP servers give the agent extra tools. Declare them in this repository's MCP config and the
		agent picks them up on the next run.
	</p>
{:else}
	<ScrollableDiv
		class="-mx-1.5 max-h-[min(32rem,calc(100vh-12rem))]"
		contentClass="px-1.5"
		fadeEdges
		ariaLabel="MCP servers"
	>
		<div
			class="divide-border-subtle divide-y-[0.5px] [&>section]:py-1 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0"
		>
			{#if groups.signIn.length > 0}
				<section aria-label="Sign in">
					<div class="flex h-8 items-center gap-2 px-1.5">
						{@render heading('alert', 'text-error-content', 'Sign in', groups.signIn.length)}
					</div>
					{@render rows(
						signInExpanded ? groups.signIn : groups.signIn.slice(0, SIGN_IN_PREVIEW),
						false,
					)}
					{#if hiddenSignIns.length > 0}
						<Button
							bare
							class="text-fg-tertiary hover:bg-surface-elevated-hover hover:text-fg-secondary flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-xs"
							ariaExpanded={false}
							onclick={() => (signInExpanded = true)}
						>
							<Icon name="chevron-down" size={14} class="shrink-0" />
							<span class="truncate">{moreLabel(hiddenSignIns)}</span>
						</Button>
					{/if}
				</section>
			{/if}

			{#if groups.claudeAi.length > 0}
				<section aria-label="Reconnect on claude.ai">
					<div class="flex h-8 items-center gap-2 px-1.5">
						{@render heading(
							'alert',
							'text-error-content',
							'Reconnect on claude.ai',
							groups.claudeAi.length,
						)}
						<Button
							variant="secondary"
							size="xs"
							class="shrink-0"
							ariaLabel="Open claude.ai connectors"
							onclick={openClaudeAiConnectorsCommand}
						>
							claude.ai
							{#snippet trailing()}
								<Icon name="external-link" size={12} />
							{/snippet}
						</Button>
					</div>
					{@render rows(groups.claudeAi, false)}
				</section>
			{/if}

			{#if groups.failed.length > 0}
				<section aria-label="Failed">
					<div class="flex h-8 items-center gap-2 px-1.5">
						{@render heading('alert', 'text-error-content', 'Failed', groups.failed.length)}
					</div>
					{@render rows(groups.failed, false)}
				</section>
			{/if}

			{#if groups.duplicates.length > 0}
				<section aria-label="Duplicates">
					<div class="flex h-8 items-center gap-2 px-1.5">
						{@render heading(
							'copy',
							'text-warning-content',
							'Duplicates',
							groups.duplicates.length,
						)}
						{#if groups.duplicates.length > 1}
							<Button variant="secondary" size="xs" class="shrink-0" onclick={onTurnOffDuplicates}>
								Turn off all
							</Button>
						{/if}
					</div>
					<p class="text-2xs text-fg-tertiary pr-1.5 pb-1 pl-7">
						A connected server with the same name already covers these.
					</p>
					{@render rows(groups.duplicates, false)}
				</section>
			{/if}

			{#if groups.connecting.length > 0}
				<section aria-label="Connecting">
					{@render rows(groups.connecting, false)}
				</section>
			{/if}

			{#if groups.ready.length > 0}
				<section aria-label="Ready">
					{@render toggle(
						'Ready',
						groups.ready.length,
						'check',
						'text-success-content',
						readyOpen,
						() => (readyChoice = !readyOpen),
					)}
					{#if readyOpen}
						{@render rows(groups.ready, false)}
					{/if}
				</section>
			{/if}

			{#if groups.off.length > 0}
				<section aria-label="Off">
					{@render toggle(
						'Off',
						groups.off.length,
						'circle-slash',
						'text-fg-tertiary',
						offExpanded,
						() => (offExpanded = !offExpanded),
					)}
					{#if offExpanded}
						{@render rows(groups.off, true)}
					{/if}
				</section>
			{/if}
		</div>
	</ScrollableDiv>
{/if}
