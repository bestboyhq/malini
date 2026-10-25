<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ChatTurnRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { activityTime } from '../job-run-time';
	import ActivityKind from './ActivityKind.svelte';

	interface Props {
		turn: ChatTurnRecord;
		nowMs: number;
		trailing?: Snippet | undefined;
	}

	let { turn, nowMs, trailing }: Props = $props();

	const look = $derived(JOB_RUN_STATUS[turn.status]);
	const place = $derived(workstreamNameQuery.data(turn.workstreamId));
	const prompt = $derived(turn.prompt || turn.chatName || 'Chat turn');
	const href = $derived(
		place === null ? null : workstreamHref(turn.workstreamId, { agentSessionId: turn.sessionId }),
	);
</script>

<div
	class={['group flex items-center gap-2 rounded-xl pr-1', href && 'hover:bg-surface-50-hover']}
	data-testid="chat-turn-row"
	data-run-id={turn.runId}
>
	<Button
		bare
		{...href === null ? { disabled: true } : { href }}
		ariaLabel={`Open chat: ${prompt}, ${look.label}`}
		class={[
			'focus-visible:ring-border-default/50 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-xl pl-2 text-left text-xs outline-none focus-visible:ring-2',
			href ? 'cursor-pointer' : 'cursor-default',
		]}
	>
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			{#if turn.status === 'running'}
				<BusyIcon size={12} />
			{:else}
				<Icon name={look.icon} size={13} />
			{/if}
		</span>
		<ActivityKind label="Chat" />
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium"><SensitiveText text={prompt} /></span>
			<span class="text-fg-tertiary">· {place ?? 'Closed workstream'}</span>
		</span>
	</Button>
	{@render trailing?.()}
	<span class="text-fg-tertiary text-2xs shrink-0 pr-1 tabular-nums">
		{activityTime(turn, nowMs)}
	</span>
</div>
