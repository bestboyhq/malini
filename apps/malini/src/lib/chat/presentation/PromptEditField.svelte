<script lang="ts">
	import { untrack } from 'svelte';
	import { adoptPastedAttachmentsCommand } from '$lib/chat/application/commands/adopt-pasted-attachments.command';
	import { detachAttachmentCommand } from '$lib/chat/application/commands/detach-attachment.command';
	import { reattachAttachmentsCommand } from '$lib/chat/application/commands/reattach-attachments.command';
	import { stageClipboardAttachmentsCommand } from '$lib/chat/application/commands/stage-clipboard-attachments.command';
	import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { elementReferenceKey } from '$lib/chat/domain/element-reference';
	import { foreignAttachmentIds, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import { Icon } from '$hyper-ui/icons';
	import InlinePromptEditor from './InlinePromptEditor.svelte';
	import { draftChipDescriptors } from './inline-prompt-chips';
	import type { ClipboardAttachmentCandidate } from './prompt-editor/clipboard-attachments';
	import { promptChipPreview } from './prompt-editor/prompt-chip-preview';

	interface Props {
		workstreamId: string;
		scope: string;
		ariaLabel: string;
		testId: string;
		disabled?: boolean;
		compact?: boolean;
		onsubmit: () => void;
		oncancel: () => void;
	}

	let {
		workstreamId,
		scope,
		ariaLabel,
		testId,
		disabled = false,
		compact = false,
		onsubmit,
		oncancel,
	}: Props = $props();

	type AttachmentRequest = Readonly<{ requestId: ChatRequestId; adopting: readonly string[] }>;

	const draft = $derived(composerDraftQuery.data(scope));
	const requestOutcome = $derived(chatRequestQuery.data);
	const chips = $derived(draftChipDescriptors(draft));

	let text = $state(untrack(() => draft.text));
	let requests = $state<AttachmentRequest[]>([]);
	let error = $state<string | null>(null);
	let editor: InlinePromptEditor | null = $state(null);

	$effect(() => {
		const settled = requests.filter((request) => {
			const outcome = requestOutcome(request.requestId);
			return outcome !== null && outcome.status !== 'pending';
		});
		if (settled.length === 0) return;
		untrack(() => {
			requests = requests.filter((request) => !settled.includes(request));
			for (const request of settled) {
				const outcome = requestOutcome(request.requestId);
				if (outcome?.status === 'failed') error = outcome.error;
				if (request.adopting.length > 0) text = draft.text;
			}
		});
	});

	function track(adopting: readonly string[]): ChatRequestId {
		const requestId = newChatRequestId();
		error = null;
		requests = [...requests, { requestId, adopting }];
		return requestId;
	}

	function onValueChange(value: string): void {
		text = value;
		updateDraftCommand(scope, { text: value });
		reattachAttachmentsCommand({ draftScope: scope, prompt: value });
		const inFlight = new Set(requests.flatMap((request) => request.adopting));
		const pasted = foreignAttachmentIds(value, draft.attachments).filter((id) => !inFlight.has(id));
		if (pasted.length === 0) return;
		adoptPastedAttachmentsCommand({
			requestId: track(pasted),
			workstreamId,
			draftScope: scope,
			attachmentIds: pasted,
		});
	}

	function onChipRemove(ref: PromptChipRef): void {
		switch (ref.kind) {
			case 'attachment':
				detachAttachmentCommand({ draftScope: scope, attachmentId: ref.id });
				return;
			case 'context':
				updateDraftCommand(scope, {
					contextFiles: draft.contextFiles.filter((path) => path !== ref.id),
				});
				return;
			case 'transcript':
				updateDraftCommand(scope, {
					transcriptReferences: draft.transcriptReferences.filter(
						({ sessionId }) => sessionId !== ref.id,
					),
				});
				return;
			case 'element':
				updateDraftCommand(scope, {
					elementReferences: draft.elementReferences.filter(
						(reference) => elementReferenceKey(reference) !== ref.id,
					),
				});
		}
	}

	function onAttachFiles(candidates: readonly ClipboardAttachmentCandidate[]): void {
		stageClipboardAttachmentsCommand({
			requestId: track([]),
			workstreamId,
			draftScope: scope,
			files: candidates.map(({ fileName, file }) => ({ fileName, file })),
		});
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			oncancel();
		} else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			onsubmit();
		}
	}

	export function focus(): void {
		editor?.focusNow({ atEnd: true });
	}
</script>

<InlinePromptEditor
	bind:this={editor}
	value={text}
	{chips}
	placeholder=""
	{compact}
	{ariaLabel}
	{testId}
	{disabled}
	resolvePreview={(ref) => promptChipPreview(ref, draft)}
	onvaluechange={onValueChange}
	onchipremove={onChipRemove}
	onattachfiles={onAttachFiles}
	onkeydown={onKeydown}
/>
{#if error}
	<p
		class="text-2xs text-error-content flex items-start gap-1.5 px-2.5 pb-1.5 leading-4"
		role="alert"
	>
		<Icon name="alert" class="mt-px shrink-0" size={13} />
		<span class="min-w-0">{error}</span>
	</p>
{/if}
