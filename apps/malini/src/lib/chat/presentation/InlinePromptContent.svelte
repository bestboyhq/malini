<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { isImageAttachment, type StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { promptChipSegments, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import { describeInlinePromptChip } from './inline-prompt-chips';
	import InlinePromptChip from './InlinePromptChip.svelte';

	interface Props {
		text: string;
		attachments?: readonly StagedAgentAttachment[];
		issueReferences?: readonly AgentIssueReference[];
		transcriptReferences?: readonly AgentTranscriptReference[];
		elementReferences?: readonly AgentElementReference[];
		pending?: boolean;
		onopenimage?: ((id: string) => void) | undefined;
	}

	let {
		text,
		attachments = [],
		issueReferences = [],
		transcriptReferences = [],
		elementReferences = [],
		pending = false,
		onopenimage,
	}: Props = $props();

	const references = $derived({
		attachments,
		issueReferences,
		transcriptReferences,
		elementReferences,
	});
	const segments = $derived(promptChipSegments(text));

	function imageOpener(ref: PromptChipRef): (() => void) | undefined {
		const open = onopenimage;
		if (!open || ref.kind !== 'attachment') return undefined;
		const attachment = attachments.find((candidate) => candidate.id === ref.id);
		if (!attachment || !isImageAttachment(attachment)) return undefined;
		return () => open(attachment.relativePath);
	}
</script>

{#each segments as segment, index (index)}
	{#if segment.kind === 'chip'}
		<InlinePromptChip
			chip={describeInlinePromptChip(segment.ref, references)}
			{pending}
			onopen={imageOpener(segment.ref)}
		/>
	{:else}
		<span class="whitespace-pre-wrap"><SensitiveText text={segment.text} /></span>
	{/if}
{/each}
