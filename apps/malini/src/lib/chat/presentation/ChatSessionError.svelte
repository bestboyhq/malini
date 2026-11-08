<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { retryChatCommand } from '$lib/chat/application/commands/retry-chat.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { sessionRetryingQuery } from '$lib/chat/application/queries/session-retrying.query.svelte';
	import { newChatRequestId } from '$lib/chat/domain/chat-request';
	import { Button } from '$hyper-ui/components/button';
	import { Strip } from '$hyper-ui/components/strip';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamId: string;
		sessionId: string | null;
		error: string;
		footerInset: number;
	}

	let { workstreamId, sessionId, error, footerInset }: Props = $props();

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
	class="chat-stage-inset min-h-0 flex-1 overflow-y-auto pt-2"
	style:padding-bottom="calc(2.5rem + {footerInset}px)"
>
	<section
		class="chat-column px-4"
		role="alert"
		data-testid="agent-session-error"
		data-navigation-error="true"
		data-navigation-error-message={error}
		data-navigation-workstream-id={workstreamId}
		data-navigation-agent-session-id={sessionId ?? undefined}
	>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-3">
			<p
				class="text-2xs text-fg-secondary font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
				data-testid="agent-session-error-text"
			>
				<SensitiveText text={error} />
			</p>
		</div>
		<Strip>
			<span class="text-error-content flex min-w-0 items-center gap-1.5">
				<Icon name="alert" size={12} class="shrink-0" />
				<span class="truncate">Agent session unavailable</span>
			</span>
			<div class="ml-auto flex shrink-0 items-center gap-1">
				<Tooltip content={copied ? 'Copied' : 'Copy full session error'} placement="top">
					<Button
						variant="ghost"
						size="sm"
						class="gap-1"
						data-testid="agent-session-error-copy"
						onclick={onCopy}
					>
						<Icon name="copy" size={12} />
						Copy error
					</Button>
				</Tooltip>
				<Button
					variant="primary"
					size="sm"
					disabled={retrying}
					ariaBusy={retrying}
					data-testid="agent-session-retry"
					onclick={retryChatCommand}
				>
					{retrying ? 'Retrying…' : 'Retry session'}
				</Button>
			</div>
		</Strip>
	</section>
</div>
