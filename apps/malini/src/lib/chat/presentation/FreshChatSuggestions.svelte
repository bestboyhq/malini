<script lang="ts">
	import { fillComposerCommand } from '$lib/chat/application/commands/fill-composer.command';
	import { selectRunProfileCommand } from '$lib/chat/application/commands/select-run-profile.command';
	import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
	import { preparedPlansQuery } from '$lib/chat/application/queries/prepared-plans.query.svelte';
	import { recentChatsQuery } from '$lib/chat/application/queries/recent-chats.query.svelte';
	import { runProfileQuery } from '$lib/chat/application/queries/run-profile.query.svelte';
	import type { SessionId } from '$lib/chat/domain/session';
	import type { SessionRecord } from '$lib/chat/domain/session-record';
	import {
		MAX_AGENT_TRANSCRIPT_REFERENCES,
		sanitizeAgentTranscriptReferences,
		type AgentTranscriptReference,
	} from '$lib/chat/domain/transcript-reference';
	import { Button } from '$hyper-ui/components/button';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { WorkstreamAutomations } from '$lib/automations/automations.api';
	import type { AgentRunMode } from '$shared/providers/providers.api';
	import { WorkstreamSetupSteps } from '$shared/repositories/repositories.api';

	type Starter = Readonly<{
		icon: IconName;
		title: string;
		detail: string;
		prompt: string;
		mode: AgentRunMode;
	}>;

	interface Props {
		workstreamId: string;
		draftScope: string;
		transcriptReferences: AgentTranscriptReference[];
		footerInset: number;
	}

	let {
		workstreamId,
		draftScope,
		transcriptReferences = $bindable(),
		footerInset,
	}: Props = $props();

	const recentChats = $derived(recentChatsQuery.data(workstreamId));
	const plans = $derived(preparedPlansQuery.data(workstreamId));
	const untouched = $derived(recentChats.length === 0);
	const referencesFull = $derived(transcriptReferences.length >= MAX_AGENT_TRANSCRIPT_REFERENCES);
	const starters: readonly Starter[] = [
		{
			icon: 'globe',
			title: 'Run it in the browser',
			detail: 'Starts it. Opens it beside the chat',
			prompt:
				'Install what this project needs and start it the way its README or scripts say. Open it in the browser beside this chat and leave it running. If it has no page to open, run it and show me what it prints.',
			mode: 'agent',
		},
		{
			icon: 'bolt',
			title: 'Find the biggest CI/CD pipeline optimizations',
			detail: 'A ranked list. No edits yet',
			prompt:
				'Read the CI/CD pipelines of this repository: the workflow files, the scripts they run and their caches. When gh can read the recent runs, use their times to measure. Find the biggest ways to make the pipelines faster or cheaper, such as missing caches, work done twice, jobs that could run in parallel, and jobs that run when nothing they cover changed. List them biggest saving first, with where each one is and what it saves. Change nothing until I pick one.',
			mode: 'agent',
		},
		{
			icon: 'workflow',
			title: 'Find all implicit state machines',
			detail: 'Flags that are secretly states',
			prompt:
				'Find every implicit state machine in this code: booleans, enums, status strings and nullable fields that together track what state something is in. For each one, list its states, the transitions and where they happen, and the combinations the code allows that should be impossible. Put the riskiest first. Change nothing until I pick one.',
			mode: 'agent',
		},
		{
			icon: 'route',
			title: 'Plan a change with me',
			detail: 'Asks first. Writes no code',
			prompt:
				'I want to change something here. Ask me what it is, then plan it with me before you write any code.',
			mode: 'plan',
		},
	];

	function start(starter: Starter): void {
		const profile = runProfileQuery.data;
		if (profile.mode !== starter.mode) selectRunProfileCommand({ ...profile, mode: starter.mode });
		fillComposerCommand(draftScope, starter.prompt);
	}

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
	class="chat-stage-inset flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pt-14"
	style:padding-bottom="{footerInset}px"
	data-testid="chat-fresh-session"
	role="region"
	aria-label="New agent chat. The next message starts a separate context."
>
	<div class="w-full max-w-[50rem] text-left">
		{#if untouched}
			<WorkstreamSetupSteps {workstreamId}>
				<ul class="flex flex-col" aria-label="Ways to start" data-testid="chat-starters">
					{#each starters as starter (starter.title)}
						<li>
							<Button
								bare
								class="group hover:bg-surface-50-hover focus-visible:bg-surface-50-hover flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left outline-none"
								onclick={() => start(starter)}
							>
								<span class="text-fg-secondary grid size-5 shrink-0 place-items-center">
									<Icon name={starter.icon} size={14} />
								</span>
								<span class="text-fg-default shrink-0 text-sm font-medium">{starter.title}</span>
								<span class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">
									{starter.detail}
								</span>
								<span
									class="text-fg-tertiary shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
									aria-hidden="true"
								>
									<Icon name="arrow-right" size={13} />
								</span>
							</Button>
						</li>
					{/each}
				</ul>
			</WorkstreamSetupSteps>
		{:else}
			<p class="text-fg-secondary text-sm">Bring useful context with you</p>
			<p class="text-fg-tertiary mt-1 text-xs leading-5">
				Start clean, or revisit a transcript or plan already prepared here.
			</p>
		{/if}

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

		<WorkstreamAutomations {workstreamId} />
	</div>
</div>
