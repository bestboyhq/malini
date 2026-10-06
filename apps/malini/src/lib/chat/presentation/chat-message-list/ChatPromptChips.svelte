<script lang="ts">
	import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
	import {
		elementReferenceChipLines,
		elementReferenceKey,
	} from '$lib/chat/domain/element-reference';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import {
		attachmentsOutsidePrompt,
		contextFilesOutsidePrompt,
		elementReferencesOutsidePrompt,
		issueReferencesOutsidePrompt,
	} from './prompt-references';

	interface Props {
		text: string;
		contextFiles?: readonly string[];
		attachments?: readonly StagedAgentAttachment[];
		issueReferences?: readonly AgentIssueReference[];
		elementReferences?: readonly AgentElementReference[];
	}

	let {
		text,
		contextFiles = [],
		attachments = [],
		issueReferences = [],
		elementReferences = [],
	}: Props = $props();

	const chipClass =
		'inline-flex h-6 max-w-56 items-center gap-1 rounded-md border-[0.5px] border-chip-border bg-chip px-1.5 text-2xs text-fg-tertiary';

	const shownContextFiles = $derived(contextFilesOutsidePrompt(text, contextFiles));
	const shownAttachments = $derived(attachmentsOutsidePrompt(text, attachments));
	const shownIssueReferences = $derived(issueReferencesOutsidePrompt(text, issueReferences));
	const shownElementReferences = $derived(elementReferencesOutsidePrompt(text, elementReferences));
</script>

{#if shownContextFiles.length}
	<div class="flex w-full flex-wrap gap-1" data-testid="chat-message-context-files">
		{#each shownContextFiles as path (path)}
			<Tooltip content={path} placement="top" class="max-w-56">
				<span class={chipClass} data-context-path={path}>
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
			{#snippet attachmentChip()}
				<span
					class={chipClass}
					data-testid="chat-message-attachment-chip"
					data-attachment-id={attachment.id}
				>
					<Icon name="paperclip" class="shrink-0" size={12} />
					<span class="truncate">{attachment.displayName}</span>
				</span>
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

{#if shownIssueReferences.length}
	<div class="flex w-full flex-wrap gap-1" data-testid="chat-message-issue-references">
		{#each shownIssueReferences as reference (reference.url)}
			{#snippet issueChip()}
				<span
					class={chipClass}
					data-testid="chat-message-issue-reference-chip"
					data-issue-provider={reference.provider}
					data-issue-url={reference.url}
				>
					<Icon name="hash" class="shrink-0" size={12} />
					<span class="truncate">{reference.identifier}</span>
				</span>
			{/snippet}
			<Tooltip content={reference.url} placement="top" class="max-w-56">
				{@render issueChip()}
			</Tooltip>
		{/each}
	</div>
{/if}

{#if shownElementReferences.length}
	<div class="flex w-full flex-col gap-1" data-testid="chat-message-element-references">
		{#each shownElementReferences as reference (elementReferenceKey(reference))}
			<span
				class="border-chip-border bg-chip text-2xs text-fg-tertiary inline-flex max-w-full items-start gap-1 rounded-md border-[0.5px] px-1.5 py-1"
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
