<script lang="ts">
	import { forkToNewChatCommand } from '$lib/chat/application/commands/fork-to-new-chat.command';
	import { undoRunCommand } from '$lib/chat/application/commands/undo-run.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import type { RunGroup } from '../render-state';
	import {
		OPEN_RUN_BLOCKS_RESTORE,
		runUndoWarning,
		type RunUndoTarget,
	} from './destructive-confirm.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		run: RunGroup;
		target?: RunUndoTarget | null;
		forkAtSeq?: number | null;
	}

	let { run, target = null, forkAtSeq = null }: Props = $props();

	const transcript = transcriptContext();
	const { runUndo } = transcript;

	const armed = $derived(runUndo.isArmed(run.runId));
	const busy = $derived(armed && runUndo.state === 'submitting');
	const failed = $derived(runUndo.state === 'failed' && runUndo.errorKey === run.runId);

	const blocked = $derived(transcript.workstreamRunInFlight);
	const warning = $derived(target ? runUndoWarning(target.changeCount) : '');
	const showFork = $derived(forkAtSeq !== null && !run.obsoleted && !run.superseded);

	let forkRequestId = $state<ChatRequestId | null>(null);
	const forkOutcome = $derived(chatRequestQuery.data(forkRequestId));
	const forking = $derived(forkOutcome?.status === 'pending');
	const forkFailed = $derived(forkOutcome?.status === 'failed' ? forkOutcome.error : null);

	function undoThisTurn(): void {
		if (blocked || !target) return;
		runUndo.confirm({
			key: run.runId,
			changeCount: () => target.changeCount,
			perform: (requestId) =>
				undoRunCommand({ requestId, runId: run.runId, checkpointId: target.checkpointId }),
		});
	}

	function forkToNewChat(): void {
		if (blocked || forking || forkAtSeq === null) return;
		const requestId = newChatRequestId();
		forkRequestId = requestId;
		forkToNewChatCommand({ requestId, atSeq: forkAtSeq });
	}
</script>

<div
	class="mr-auto flex min-w-0 items-center gap-1.5"
	data-testid="chat-run-undo"
	data-undo-run-id={run.runId}
>
	{#if target}
		{#if armed}
			<span
				class="text-2xs text-error-content flex min-w-0 items-center gap-1.5"
				role="alert"
				data-testid="chat-run-undo-warning"
			>
				<Icon name="warning" size={12} class="shrink-0" />
				<span class="truncate">{warning}</span>
			</span>
			<Button
				bare
				class="text-2xs text-fg-secondary hover:text-fg-default focus-visible:ring-border-default/50 h-5 shrink-0 cursor-pointer rounded px-1.5 font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
				data-testid="chat-run-undo-dismiss"
				disabled={busy}
				onclick={() => runUndo.disarm()}
			>
				Keep
			</Button>
			<Tooltip content={OPEN_RUN_BLOCKS_RESTORE} placement="top" suppressed={!blocked}>
				<Button
					bare
					class="bg-error text-2xs text-error-content focus-visible:ring-error-content/30 h-5 shrink-0 cursor-pointer rounded px-1.5 font-medium transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					data-testid="chat-run-undo-confirm"
					ariaBusy={busy}
					disabled={busy || blocked}
					onclick={undoThisTurn}
				>
					{busy ? 'Undoing…' : 'Undo'}
				</Button>
			</Tooltip>
		{:else}
			{#if failed}
				<span
					class="text-2xs text-error-content min-w-0 truncate"
					role="alert"
					data-testid="chat-run-undo-error"
				>
					{runUndo.error}
				</span>
			{/if}
			<Tooltip content={blocked ? OPEN_RUN_BLOCKS_RESTORE : warning} placement="top">
				<Button
					bare
					class="text-2xs text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					data-testid="chat-run-undo-arm"
					disabled={blocked}
					onclick={undoThisTurn}
				>
					<Icon name="undo" size={14} />
					Undo this turn
				</Button>
			</Tooltip>
		{/if}
	{/if}
	{#if showFork && !armed}
		{#if forkFailed}
			<span
				class="text-2xs text-error-content min-w-0 truncate"
				role="alert"
				data-testid="chat-run-fork-error"
			>
				{forkFailed}
			</span>
		{/if}
		<Tooltip
			content={blocked
				? 'Finish the open run before forking'
				: 'Start a new chat with this transcript attached'}
			placement="top"
		>
			<Button
				bare
				class="text-2xs text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
				data-testid="chat-run-fork"
				ariaLabel="Fork to new chat"
				ariaBusy={forking}
				disabled={forking || blocked}
				onclick={forkToNewChat}
			>
				<Icon name="branch" size={14} />
				Fork to new chat
			</Button>
		</Tooltip>
	{/if}
</div>
