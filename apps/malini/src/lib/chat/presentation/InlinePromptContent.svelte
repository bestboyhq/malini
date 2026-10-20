<script lang="ts">
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { promptChipSegments, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import {
		attachmentOpener,
		describeInlinePromptChip,
		type ChipOpener,
	} from './inline-prompt-chips';
	import InlinePromptChip from './InlinePromptChip.svelte';
	import { promptCodeFences } from './prompt-code-fences';

	interface Props {
		text: string;
		attachments?: readonly StagedAgentAttachment[];
		transcriptReferences?: readonly AgentTranscriptReference[];
		elementReferences?: readonly AgentElementReference[];
		pending?: boolean;
		singleLine?: boolean;
		onopenattachment?: ((attachment: StagedAgentAttachment) => void) | undefined;
	}

	let {
		text,
		attachments = [],
		transcriptReferences = [],
		elementReferences = [],
		pending = false,
		singleLine = false,
		onopenattachment,
	}: Props = $props();

	const references = $derived({
		attachments,
		transcriptReferences,
		elementReferences,
	});
	const segments = $derived(promptChipSegments(text));
	const whitespace = $derived(singleLine ? 'whitespace-nowrap' : 'whitespace-pre-wrap');

	function chipOpener(ref: PromptChipRef): ChipOpener | undefined {
		if (ref.kind !== 'attachment') return undefined;
		const attachment = attachments.find((candidate) => candidate.id === ref.id);
		return attachment && attachmentOpener(attachment, onopenattachment);
	}
</script>

{#each segments as segment, index (index)}
	{#if segment.kind === 'chip'}
		<InlinePromptChip
			chip={describeInlinePromptChip(segment.ref, references)}
			{pending}
			opener={chipOpener(segment.ref)}
		/>
	{:else}
		{#each promptCodeFences(segment.text) as part, partIndex (partIndex)}
			{#if part.kind === 'code'}
				<span class={['font-mono', whitespace]}>
					{part.open}<CodeTokens code={part.code} language={part.language} />{part.close}
				</span>
			{:else}
				<span class={whitespace}><SensitiveText text={part.text} /></span>
			{/if}
		{/each}
	{/if}
{/each}
