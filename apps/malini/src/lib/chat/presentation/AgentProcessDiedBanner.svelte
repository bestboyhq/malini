<script lang="ts">
	import { restartAgentCommand } from '$lib/chat/application/commands/restart-agent.command';
	import { agentProcessDiedQuery } from '$lib/chat/application/queries/agent-process-died.query.svelte';
	import { agentRestartingQuery } from '$lib/chat/application/queries/agent-restarting.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Strip } from '$hyper-ui/components/strip';
	import { Icon } from '$hyper-ui/icons';

	const died = $derived(agentProcessDiedQuery.data);
	const restarting = $derived(agentRestartingQuery.data);
</script>

{#if died}
	<section
		class="chat-column relative z-20 px-4 pb-2"
		role="status"
		aria-live="polite"
		data-testid="agent-process-died-banner"
	>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-3">
			<p class="text-fg-default text-sm leading-6">
				The agent bridge stopped responding mid-run. Restart it now, clear the stuck run, and
				reconnect this workstream without reloading Malini.
			</p>
		</div>
		<Strip>
			<span class="text-warning-content flex min-w-0 items-center gap-1.5">
				<Icon name="alert" size={12} class="shrink-0" />
				<span class="truncate">Agent process died</span>
			</span>
			<Button
				variant="primary"
				size="sm"
				class="ml-auto"
				data-testid="agent-process-died-reset"
				disabled={restarting}
				ariaBusy={restarting}
				onclick={restartAgentCommand}
			>
				{restarting ? 'Restarting…' : 'Restart agent process'}
			</Button>
		</Strip>
	</section>
{/if}
