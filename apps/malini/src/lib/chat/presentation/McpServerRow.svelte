<script lang="ts">
	import type { SessionId } from '$lib/chat/domain/session';
	import { authorizeMcpServerCommand } from '$lib/chat/application/commands/authorize-mcp-server.command';
	import { reconnectMcpServerCommand } from '$lib/chat/application/commands/reconnect-mcp-server.command';
	import { mcpServerBusyQuery } from '$lib/chat/application/queries/mcp-server-busy.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
	import type { McpServerSnapshot } from './session-runtime-metadata';

	interface Props {
		server: McpServerSnapshot;
		sessionId: SessionId | null;
	}

	let { server, sessionId }: Props = $props();
	const busy = $derived(sessionId ? mcpServerBusyQuery.data(sessionId, server.name) : false);
	const failure = $derived(sanitizeFailureDetail(server.error) || 'Could not connect');

	function onSignIn(): void {
		if (sessionId) authorizeMcpServerCommand(sessionId, server.name, server.displayName);
	}

	function onRetry(): void {
		if (sessionId) reconnectMcpServerCommand(sessionId, server.name, server.displayName);
	}
</script>

{#snippet action(label: string, ariaLabel: string, onclick: () => void)}
	<Button
		variant="secondary"
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
	class="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-xs"
	data-testid="session-mcp-status-row"
	data-mcp-server-id={server.name}
	data-mcp-usable={server.usable ? 'true' : 'false'}
>
	{#if server.status === 'connected'}
		<Icon name="check" size={14} class="text-success-content shrink-0" />
	{:else if server.status === 'pending'}
		<LoadingCircle size={14} />
	{:else if server.status === 'needs-auth'}
		<Icon name="alert" size={14} class="text-error-content shrink-0" />
	{:else if server.status === 'failed'}
		<Tooltip content={failure} placement="top" class="shrink-0">
			<Icon name="alert" size={14} class="text-error-content" />
		</Tooltip>
	{:else}
		<Icon name="circle" size={14} class="text-fg-tertiary shrink-0" />
	{/if}
	<Tooltip content={`MCP server ID: ${server.name}`} placement="top" class="min-w-0 flex-1">
		<p class="text-fg-default truncate font-medium" data-testid="session-mcp-display-name">
			{server.displayName}
		</p>
	</Tooltip>
	{#if sessionId && server.status === 'needs-auth'}
		{@render action('Sign in', `Sign in to ${server.displayName}`, onSignIn)}
	{:else if sessionId && server.status === 'failed'}
		{@render action('Retry', `Retry ${server.displayName}`, onRetry)}
	{:else if server.status === 'pending'}
		<span class="text-2xs text-fg-tertiary shrink-0">Connecting</span>
	{:else if server.status === 'disabled'}
		<span class="text-2xs text-fg-tertiary shrink-0">Off</span>
	{/if}
</li>
