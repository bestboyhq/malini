import { tick } from 'svelte';
import { beginPromptEditCommand } from '$lib/chat/application/commands/begin-prompt-edit.command';
import { editCheckpointCommand } from '$lib/chat/application/commands/edit-checkpoint.command';
import { endPromptEditCommand } from '$lib/chat/application/commands/end-prompt-edit.command';
import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { RunGroup } from '../render-state';
import {
	createDestructiveConfirm,
	fileChangesSinceCheckpoint,
	type CheckpointItem,
} from './destructive-confirm.svelte';

export { fileChangesSinceCheckpoint, type CheckpointItem };

export function checkpointRestoreWarning(changeCount: number): string {
	if (changeCount === 0) {
		return 'Discards every reply after this message. No file changes have been made since.';
	}
	return changeCount === 1
		? 'Discards 1 file change made since this message, and every reply after it.'
		: `Discards ${changeCount} file changes made since this message, and every reply after it.`;
}

export type CheckpointEditor = {
	readonly editingCheckpointId: string | null;
	readonly armedCheckpointId: string | null;
	readonly armedCheckpointChangeCount: number;
	readonly checkpointEditState: 'idle' | 'submitting' | 'failed';
	readonly checkpointEditError: string | null;
	readonly editingScope: string;
	readonly editingPrompt: string;
	field: { focus(): void } | null;
	isEditing(item: CheckpointItem): boolean;
	isArmed(item: CheckpointItem): boolean;
	requestCheckpointEdit(item: CheckpointItem, target: EventTarget | null): void;
	cancelCheckpointEdit(): void;
	disarmCheckpointEdit(): void;
	submitCheckpointEdit(item: CheckpointItem): void;
};

export function createCheckpointEditor(input: {
	outcomeOf(requestId: ChatRequestId): ChatRequestOutcome | null;
	runs(): readonly RunGroup[];
	blocked(): boolean;
	workstreamId(): string;
	openEditor(row: HTMLElement | null, mutate: () => Promise<void>): Promise<void>;
}): CheckpointEditor {
	const { runs, blocked, openEditor } = input;
	const confirmation = createDestructiveConfirm({
		outcomeOf: input.outcomeOf,
		onAccepted: () => closeEditor(editDraft().attachments),
	});
	let editingCheckpointId = $state<string | null>(null);
	let originalAttachments: readonly StagedAgentAttachment[] = [];
	let field: { focus(): void } | null = $state(null);
	const editingScope = $derived(editingCheckpointId ? editScope(editingCheckpointId) : '');

	function editScope(checkpointId: string): string {
		return `edit|checkpoint:${checkpointId}`;
	}

	function editDraft(): ReturnType<typeof composerDraftQuery.data> {
		return composerDraftQuery.data(editingScope);
	}

	function requestCheckpointEdit(item: CheckpointItem, target: EventTarget | null): void {
		if (target instanceof Element && target.closest('a, button')) return;
		const row = target instanceof Element ? target.closest<HTMLElement>('[data-prompt-row]') : null;
		void startCheckpointEdit(item, row);
	}

	async function startCheckpointEdit(item: CheckpointItem, row: HTMLElement | null): Promise<void> {
		const checkpointId = item.checkpointId;
		if (!checkpointId) return;
		confirmation.reset();
		if (editingCheckpointId) closeEditor(originalAttachments);
		originalAttachments = item.attachments ?? [];
		beginPromptEditCommand(editScope(checkpointId), {
			text: item.text,
			contextFiles: item.contextFiles ?? [],
			attachments: originalAttachments,
			issueReferences: item.issueReferences ?? [],
			transcriptReferences: item.transcriptReferences ?? [],
			elementReferences: item.elementReferences ?? [],
		});
		await openEditor(row, async () => {
			editingCheckpointId = checkpointId;
			await tick();
		});
		field?.focus();
	}

	function closeEditor(keep: readonly StagedAgentAttachment[]): void {
		const checkpointId = editingCheckpointId;
		if (!checkpointId) return;
		endPromptEditCommand({
			workstreamId: input.workstreamId(),
			scope: editScope(checkpointId),
			keep,
		});
		editingCheckpointId = null;
	}

	function cancelCheckpointEdit(): void {
		if (confirmation.state === 'submitting') return;
		closeEditor(originalAttachments);
		confirmation.reset();
	}

	function submitCheckpointEdit(item: CheckpointItem): void {
		const checkpointId = item.checkpointId;
		const edit = editDraft();
		if (!checkpointId || !edit.text.trim()) return;
		if (blocked()) return;

		confirmation.confirm({
			key: checkpointId,
			changeCount: () => fileChangesSinceCheckpoint(item, runs()),
			perform: (requestId) =>
				editCheckpointCommand({
					requestId,
					checkpointId,
					prompt: edit.text.trim(),
					contextFiles: edit.contextFiles,
					attachments: edit.attachments,
					issueReferences: edit.issueReferences,
					transcriptReferences: edit.transcriptReferences,
					elementReferences: edit.elementReferences,
				}),
		});
	}

	return {
		get editingCheckpointId(): string | null {
			return editingCheckpointId;
		},
		get armedCheckpointId(): string | null {
			return confirmation.armedKey;
		},
		get armedCheckpointChangeCount(): number {
			return confirmation.armedChangeCount;
		},
		get checkpointEditState(): 'idle' | 'submitting' | 'failed' {
			return confirmation.state;
		},
		get checkpointEditError(): string | null {
			return confirmation.error;
		},
		get editingScope(): string {
			return editingScope;
		},
		get editingPrompt(): string {
			return editDraft().text;
		},
		get field(): { focus(): void } | null {
			return field;
		},
		set field(value: { focus(): void } | null) {
			field = value;
		},
		isEditing: (item) => Boolean(item.checkpointId) && editingCheckpointId === item.checkpointId,
		isArmed: (item) => confirmation.isArmed(item.checkpointId),
		requestCheckpointEdit,
		cancelCheckpointEdit,
		disarmCheckpointEdit: confirmation.disarm,
		submitCheckpointEdit,
	};
}
