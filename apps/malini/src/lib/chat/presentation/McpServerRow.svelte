<script lang="ts">
	import type { McpServerTarget } from '$contract/mcp-servers';
	import { mcpOriginTag, type McpServer, type McpServerFix } from '$lib/chat/domain/mcp-server';
	import { authorizeMcpServerCommand } from '$lib/chat/application/commands/authorize-mcp-server.command';
	import { reconnectMcpServerCommand } from '$lib/chat/application/commands/reconnect-mcp-server.command';
	import { switchMcpServerCommand } from '$lib/chat/application/commands/switch-mcp-server.command';
	import { mcpServerBusyQuery } from '$lib/chat/application/queries/mcp-server-busy.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Icon } from '$hyper-ui/icons';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		server: McpServer;
		fix: McpServerFix | null;
		off: boolean;
		target: McpServerTarget | null;
		showOrigin: boolean;
	}

	let { server, fix, off, target, showOrigin }: Props = $props();
	const busy = $derived(target ? mcpServerBusyQuery.data(target, server.name) : false);
	const failure = $derived(
		!off && server.status === 'failed' && fix !== 'duplicate'
			? sanitizeFailureDetail(server.error) || 'Could not connect'
			: null,
	);

	function onSignIn(): void {
		if (target) authorizeMcpServerCommand(target, server.name, server.displayName);
	}

	function onRetry(): void {
		if (target) reconnectMcpServerCommand(target, server.name, server.displayName);
	}

	function onSwitch(on: boolean): void {
		switchMcpServerCommand([server.name], server.displayName, on);
	}
</script>

{#snippet action(
	label: string,
	ariaLabel: string,
	onclick: () => void,
	variant: 'secondary' | 'ghost',
)}
	<Button
		{variant}
		size="xs"
		class="shrink-0"
		loading={busy}
		{ariaLabel}
		{onclick}
		data-testid="session-mcp-action"
	>
		{label}
	</Button>
{/snippet}

<li
	class="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs"
	data-testid="session-mcp-status-row"
	data-mcp-server-id={server.name}
	data-mcp-status={off ? 'off' : server.status}
>
	{#if off}
		<Icon name="circle-slash" size={14} class="text-fg-tertiary shrink-0" />
	{:else if server.status === 'connected'}
		<Icon name="check" size={14} class="text-success-content shrink-0" />
	{:else if server.status === 'pending'}
		<LoadingCircle size={14} />
	{:else}
		<Icon name="circle" size={14} class="text-fg-tertiary shrink-0" />
	{/if}
	<div class="min-w-0 flex-1">
		<p class="flex min-w-0 items-center gap-1.5">
			<span
				class={['truncate font-medium', off ? 'text-fg-tertiary' : 'text-fg-default']}
				data-testid="session-mcp-display-name"
			>
				{server.displayName}
			</span>
			{#if showOrigin}
				<span
					class="bg-surface-elevated-selected text-fg-tertiary text-3xs shrink-0 rounded px-1 py-px font-medium"
				>
					{mcpOriginTag(server.origin)}
				</span>
			{/if}
		</p>
		{#if failure}
			<p class="text-2xs text-fg-tertiary mt-0.5 line-clamp-2 leading-4 break-words">{failure}</p>
		{/if}
	</div>
	{#if off}
		{@render action('Turn on', `Turn on ${server.displayName}`, () => onSwitch(true), 'ghost')}
	{:else if fix === 'duplicate'}
		{@render action('Turn off', `Turn off ${server.displayName}`, () => onSwitch(false), 'ghost')}
	{:else if target && fix === 'sign-in'}
		{@render action('Sign in', `Sign in to ${server.displayName}`, onSignIn, 'secondary')}
	{:else if target && fix === 'reconnect-on-claude-ai'}
		{@render action('Retry', `Retry ${server.displayName}`, onRetry, 'ghost')}
	{:else if target && fix === 'retry'}
		{@render action('Retry', `Retry ${server.displayName}`, onRetry, 'secondary')}
	{:else if server.status === 'pending'}
		<span class="text-2xs text-fg-tertiary shrink-0">Connecting</span>
	{:else if server.status === 'connected' && server.toolCount !== null}
		<span class="text-2xs text-fg-tertiary shrink-0 tabular-nums">
			{server.toolCount === 1 ? '1 tool' : `${server.toolCount} tools`}
		</span>
	{/if}
</li>
