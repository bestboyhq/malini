<script lang="ts">
	import type { AgentActionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import {
		AGENT_ACTION_APPROVAL,
		agentActionInput,
		agentActionOutput,
		agentActionTitle,
	} from '$lib/jobs/domain/agent-action';
	import { jobName } from '../job-name';
	import ActivityKind from './ActivityKind.svelte';
	import { AGENT_ACTION_STATUS } from '../job-run-status';
	import { activityTime } from '../job-run-time';

	interface Props {
		action: AgentActionRecord;
		nowMs: number;
		nested?: boolean;
		kind?: string;
	}

	let { action, nowMs, nested = false, kind }: Props = $props();

	let open = $state(false);

	const detailsId = $props.id();
	const look = $derived(AGENT_ACTION_STATUS[action.status]);
	const workstreamName = (id: string): string => workstreamNameQuery.data(id) ?? id;
	const title = $derived(agentActionTitle(action, { job: jobName, workstream: workstreamName }));
	const place = $derived(
		action.workstreamId === null ? null : workstreamNameQuery.data(action.workstreamId),
	);
	const shownPlace = $derived(nested ? null : place);
	const approval = $derived(AGENT_ACTION_APPROVAL[action.approval]);
	const input = $derived(agentActionInput(action));
	const output = $derived(agentActionOutput(action));
	const chatHref = $derived(
		action.workstreamId && place !== null
			? workstreamHref(action.workstreamId, { agentSessionId: action.sessionId })
			: null,
	);
</script>

<div data-testid="agent-action-row" data-agent-action-id={action.id}>
	<Button
		bare
		ariaExpanded={open}
		ariaControls={detailsId}
		ariaLabel={`${title}, ${look.label}`}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-xs outline-none focus-visible:ring-2"
		onclick={() => (open = !open)}
	>
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			{#if action.status === 'running'}
				<LoadingCircle size={12} />
			{:else}
				<Icon name={look.icon} size={13} />
			{/if}
		</span>
		{#if kind}
			<ActivityKind label={kind} />
		{/if}
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium">{title}</span>
			{#if shownPlace}
				<span class="text-fg-tertiary">· {shownPlace}</span>
			{/if}
			{#if approval}
				<span class="text-fg-tertiary">· {approval}</span>
			{/if}
		</span>
		<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums">
			{activityTime(action, nowMs)}
		</span>
	</Button>
	{#if open}
		<div id={detailsId} class="flex flex-col gap-2 pt-1 pr-3 pb-2.5 pl-8">
			<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs leading-5">
				<dt class="text-fg-tertiary">Tool</dt>
				<dd class="text-fg-secondary font-mono">{action.tool}</dd>
				{#if input}
					<dt class="text-fg-tertiary">Called with</dt>
					<dd
						class="text-fg-secondary max-h-48 overflow-y-auto font-mono break-words whitespace-pre-wrap select-text"
					>
						<CodeTokens code={input} language="json" />
					</dd>
				{/if}
				{#if output}
					<dt class="text-fg-tertiary">{action.status === 'failed' ? 'Error' : 'Result'}</dt>
					<dd
						class="text-fg-secondary max-h-48 overflow-y-auto font-mono break-words whitespace-pre-wrap select-text"
					>
						<CodeTokens code={output} language={action.status === 'failed' ? null : 'json'} />
					</dd>
				{/if}
			</dl>
			{#if chatHref}
				<Button variant="ghost" size="xs" href={chatHref} class="-ml-2 self-start">
					{#snippet leading()}
						<Icon name="chat" size={12} />
					{/snippet}
					Open chat
				</Button>
			{/if}
		</div>
	{/if}
</div>
