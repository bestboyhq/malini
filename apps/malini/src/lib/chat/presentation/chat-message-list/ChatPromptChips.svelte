<script lang="ts">
	import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import {
		elementReferenceChipLines,
		elementReferenceKey,
	} from '$lib/chat/domain/element-reference';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		attachmentsOutsidePrompt,
		contextFilesOutsidePrompt,
		elementReferencesOutsidePrompt,
	} from './prompt-references';
	import { attachmentOpener, CHIP_CLASS, OPENABLE_CHIP_CLASS } from '../inline-prompt-chips';

	interface Props {
		text: string;
		contextFiles?: readonly string[];
		attachments?: readonly StagedAgentAttachment[];
		elementReferences?: readonly AgentElementReference[];
		onopenattachment?: ((attachment: StagedAgentAttachment) => void) | undefined;
	}

	let {
		text,
		contextFiles = [],
		attachments = [],
		elementReferences = [],
		onopenattachment,
	}: Props = $props();

	const shownContextFiles = $derived(contextFilesOutsidePrompt(text, contextFiles));
	const shownAttachments = $derived(attachmentsOutsidePrompt(text, attachments));
	const shownElementReferences = $derived(elementReferencesOutsidePrompt(text, elementReferences));
</script>

{#if shownContextFiles.length}
	<div class="flex w-full flex-wrap gap-1" data-testid="chat-message-context-files">
		{#each shownContextFiles as path (path)}
			<Tooltip content={path} placement="top" onlyWhenTruncated class="max-w-56">
				<span class={CHIP_CLASS} data-context-path={path}>
					<FileTypeIcon {path} size={12} />
					<span class="truncate font-mono">{path}</span>
				</span>
			</Tooltip>
		{/each}
	</div>
{/if}

{#if shownAttachments.length}
	<div class="flex w-full flex-wrap gap-1" data-testid="chat-message-attachments">
		{#each shownAttachments as attachment (attachment.id)}
			{@const opener = attachmentOpener(attachment, onopenattachment)}
			{#snippet attachmentChip()}
				{#if opener}
					<Button
						bare
						class={[CHIP_CLASS, OPENABLE_CHIP_CLASS]}
						ariaLabel={opener.label}
						data-testid="chat-message-attachment-chip"
						data-attachment-id={attachment.id}
						onclick={opener.open}
					>
						<FileTypeIcon path={attachment.displayName} size={12} />
						<span class="truncate">{attachment.displayName}</span>
					</Button>
				{:else}
					<span
						class={CHIP_CLASS}
						data-testid="chat-message-attachment-chip"
						data-attachment-id={attachment.id}
					>
						<FileTypeIcon path={attachment.displayName} size={12} />
						<span class="truncate">{attachment.displayName}</span>
					</span>
				{/if}
			{/snippet}
			<Tooltip
				content={`${attachment.displayName} · ${attachment.mediaType} · ${attachment.size} bytes`}
				placement="top"
				class="max-w-56"
			>
				{@render attachmentChip()}
			</Tooltip>
		{/each}
	</div>
{/if}

{#if shownElementReferences.length}
	<div class="flex w-full flex-col gap-1" data-testid="chat-message-element-references">
		{#each shownElementReferences as reference (elementReferenceKey(reference))}
			<span
				class="border-chip-border bg-chip text-2xs text-fg-secondary inline-flex max-w-full items-start gap-1 rounded-md border px-1.5 py-1"
				data-testid="chat-message-element-reference-chip"
				data-element-url={reference.url}
				data-element-dom-path={reference.domPath}
			>
				<Icon name="preview" class="mt-0.5 shrink-0" size={12} />
				<span class="flex min-w-0 flex-col gap-0.5">
					{#each elementReferenceChipLines(reference) as line (line)}
						<span class="block truncate">{line}</span>
					{/each}
				</span>
			</span>
		{/each}
	</div>
{/if}
