<script lang="ts">
	import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
	import { preparedPlansQuery } from '$lib/chat/application/queries/prepared-plans.query.svelte';
	import { recentChatsQuery } from '$lib/chat/application/queries/recent-chats.query.svelte';
	import type { SessionId } from '$lib/chat/domain/session';
	import type { SessionRecord } from '$lib/chat/domain/session-record';
	import {
		MAX_AGENT_TRANSCRIPT_REFERENCES,
		sanitizeAgentTranscriptReferences,
		type AgentTranscriptReference,
	} from '$lib/chat/domain/transcript-reference';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		workstreamId: string;
		draftScope: string;
		transcriptReferences: AgentTranscriptReference[];
	}

	let { workstreamId, draftScope, transcriptReferences = $bindable() }: Props = $props();

	const recentChats = $derived(recentChatsQuery.data(workstreamId));
	const plans = $derived(preparedPlansQuery.data(workstreamId));
	const referencesFull = $derived(transcriptReferences.length >= MAX_AGENT_TRANSCRIPT_REFERENCES);

	function selected(sessionId: SessionId): boolean {
		return transcriptReferences.some((reference) => reference.sessionId === sessionId);
	}

	function onReference(session: SessionRecord, label = session.displayName): void {
		if (selected(session.id)) return;
		transcriptReferences = sanitizeAgentTranscriptReferences([
			...transcriptReferences,
			{ sessionId: session.id, label },
		]);
		updateDraftCommand(draftScope, { transcriptReferences });
	}
</script>

<div
	class="chat-stage-inset flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pt-14 pb-[var(--chat-footer-inset,0px)]"
	data-testid="chat-fresh-session"
	role="region"
	aria-label="New agent chat. The next message starts a separate context."
>
	<div class="w-full max-w-xl text-left">
		<p class="text-fg-secondary text-sm">Bring useful context with you</p>
		<p class="text-fg-tertiary mt-1 text-xs leading-5">
			Start clean, or revisit a transcript or plan already prepared in this workstream.
		</p>

		{#if recentChats.length > 0}
			<div class="mt-5">
				<p class="text-2xs text-fg-tertiary">Recent transcripts</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each recentChats as chat (chat.id)}
						<Button
							variant="secondary"
							size="sm"
							class="border-chip-border bg-chip hover:bg-surface-150-hover h-8 max-w-52 border-[1px] px-2.5 text-xs"
							data-testid="chat-fresh-transcript-suggestion"
							data-selected={selected(chat.id) ? 'true' : undefined}
							ariaPressed={selected(chat.id)}
							disabled={!selected(chat.id) && referencesFull}
							onclick={() => onReference(chat)}
						>
							<Icon name="chat" size={13} />
							<span class="truncate">{chat.displayName}</span>
						</Button>
					{/each}
				</div>
			</div>
		{/if}

		{#if plans.length > 0}
			<div class="mt-4">
				<p class="text-2xs text-fg-tertiary">Plans prepared here</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each plans as plan (plan.session.id)}
						<Button
							variant="primary-soft"
							size="sm"
							class="h-8 max-w-64 px-2.5 text-xs"
							data-testid="chat-fresh-plan-suggestion"
							data-selected={selected(plan.session.id) ? 'true' : undefined}
							ariaPressed={selected(plan.session.id)}
							disabled={!selected(plan.session.id) && referencesFull}
							onclick={() => onReference(plan.session, `Plan: ${plan.label}`)}
						>
							<Icon name="route" size={13} />
							<span class="truncate">{plan.label}</span>
						</Button>
					{/each}
				</div>
			</div>
		{/if}

		{#if recentChats.length === 0}
			<p class="text-2xs text-fg-tertiary mt-4 leading-5">
				This workstream does not have an earlier transcript or plan yet.
			</p>
		{/if}
	</div>
</div>
