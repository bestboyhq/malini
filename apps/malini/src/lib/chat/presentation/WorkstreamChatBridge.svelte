<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PullRequestActionInput } from '@malini-extension/repository';
	import { awaitAutomatedPromptHook } from '$lib/chat/application/hooks/await-automated-prompt.hook';
	import { pullRequestEvidenceQuery } from '$lib/chat/application/queries/pull-request-evidence.query.svelte';
	import { requestedSessionQuery } from '$lib/chat/application/queries/requested-session.query.svelte';
	import { workstreamAgentRunningQuery } from '$lib/chat/application/queries/workstream-agent-running.query.svelte';

	type WorkstreamChatSeams = Readonly<{
		submitAutomatedPrompt(prompt: string): Promise<void>;
		chatEvidence(): PullRequestActionInput;
		agentRunning: boolean;
	}>;

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSeams]>;
	}

	let { workstreamId, children }: Props = $props();

	const awaitAutomatedPrompt = awaitAutomatedPromptHook();
	const evidenceFor = $derived(pullRequestEvidenceQuery.data);
	const requestedSessionId = $derived(requestedSessionQuery.data);
	const agentRunning = $derived(workstreamAgentRunningQuery.data(workstreamId));

	const seams: WorkstreamChatSeams = {
		submitAutomatedPrompt: (prompt) => awaitAutomatedPrompt(workstreamId, prompt),
		chatEvidence: () => evidenceFor(workstreamId, requestedSessionId),
		get agentRunning(): boolean {
			return agentRunning;
		},
	};
</script>

{@render children(seams)}
