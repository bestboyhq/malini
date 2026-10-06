<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { retryChatCommand } from '$lib/chat/application/commands/retry-chat.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { sessionRetryingQuery } from '$lib/chat/application/queries/session-retrying.query.svelte';
	import { newChatRequestId } from '$lib/chat/domain/chat-request';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamId: string;
		sessionId: string | null;
		error: string;
	}

	let { workstreamId, sessionId, error }: Props = $props();

	let copyRequest = $state<Readonly<{ requestId: string; error: string }> | null>(null);
	const copyOutcome = $derived(chatRequestQuery.data(copyRequest?.requestId ?? null));
	const copied = $derived(copyRequest?.error === error && copyOutcome?.status === 'accepted');
	const retrying = $derived(sessionRetryingQuery.data);

	function onCopy(): void {
		const requestId = newChatRequestId();
		copyRequest = { requestId, error };
		copyTextCommand({ requestId, text: error });
	}
</script>

<div
	class="chat-stage-inset grid min-h-0 flex-1 place-items-center px-6 pt-10 pb-[calc(2.5rem+var(--chat-footer-inset,0px))]"
>
	<div
		class="border-surface-50-border bg-surface-50 w-full max-w-md rounded-md border p-4 text-left shadow-sm"
		role="alert"
		data-testid="agent-session-error"
		data-navigation-error="true"
		data-navigation-error-message={error}
		data-navigation-workstream-id={workstreamId}
		data-navigation-agent-session-id={sessionId ?? undefined}
	>
		<div class="flex items-start gap-3">
			<span
				class="bg-error/10 text-error-content grid h-8 w-8 shrink-0 place-items-center rounded-full"
				aria-hidden="true"
			>
				<Icon name="alert" size={16} />
			</span>
			<div class="min-w-0 flex-1">
				<h3 class="text-fg-default text-sm font-medium">Agent session unavailable</h3>
				<p
					class="text-fg-tertiary mt-1 text-xs leading-5 break-words whitespace-pre-wrap select-text"
					data-testid="agent-session-error-text"
				>
					<SensitiveText text={error} />
				</p>
				<Tooltip content={copied ? 'Copied' : 'Copy full session error'} placement="top">
					<Button
						variant="ghost"
						size="auto"
						class="text-2xs text-fg-tertiary mt-2 h-7 px-2"
						ariaLabel="Copy session error"
						data-testid="agent-session-error-copy"
						onclick={onCopy}
					>
						<Icon name="copy" size={13} />
						Copy error
					</Button>
				</Tooltip>
				<Button
					variant="primary"
					size="sm"
					class="mt-3 h-8 px-3 text-xs"
					disabled={retrying}
					ariaBusy={retrying}
					data-testid="agent-session-retry"
					onclick={retryChatCommand}
				>
					{retrying ? 'Retrying…' : 'Retry session'}
				</Button>
			</div>
		</div>
	</div>
</div>
