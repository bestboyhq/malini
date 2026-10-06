<script lang="ts">
	import { restartAgentCommand } from '$lib/chat/application/commands/restart-agent.command';
	import { agentProcessDiedQuery } from '$lib/chat/application/queries/agent-process-died.query.svelte';
	import { agentRestartingQuery } from '$lib/chat/application/queries/agent-restarting.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';

	const died = $derived(agentProcessDiedQuery.data);
	const restarting = $derived(agentRestartingQuery.data);
</script>

{#if died}
	<div
		role="status"
		aria-live="polite"
		data-testid="agent-process-died-banner"
		class="border-surface-50-border bg-surface-50 text-fg-default flex w-full shrink-0 items-start gap-3 border-b px-4 py-3"
	>
		<div
			class="bg-warning text-warning-content grid h-7 w-7 shrink-0 place-items-center rounded-md"
			aria-hidden="true"
		>
			<Icon name="alert" size={16} />
		</div>
		<div class="min-w-0 flex-1">
			<p class="text-fg-default text-sm font-medium">Agent process died</p>
			<p class="text-fg-secondary mt-1 text-sm leading-6">
				The agent bridge stopped responding mid-run. Restart it now, clear the stuck run, and
				reconnect this workstream without reloading malini.
			</p>
			<div class="mt-3">
				<Button
					variant="warning"
					size="auto"
					class="px-3 py-1.5 text-xs"
					data-testid="agent-process-died-reset"
					disabled={restarting}
					ariaBusy={restarting}
					onclick={restartAgentCommand}
				>
					{restarting ? 'Restarting…' : 'Restart agent process'}
				</Button>
			</div>
		</div>
	</div>
{/if}
