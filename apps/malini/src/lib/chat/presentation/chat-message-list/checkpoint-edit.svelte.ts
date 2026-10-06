import { tick } from 'svelte';
import { editCheckpointCommand } from '$lib/chat/application/commands/edit-checkpoint.command';
import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';
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
	editingPrompt: string;
	element: HTMLTextAreaElement | null;
	isEditing(item: CheckpointItem): boolean;
	isArmed(item: CheckpointItem): boolean;
	requestCheckpointEdit(item: CheckpointItem, target: EventTarget | null): void;
	autosizeCheckpointEditor(): void;
	cancelCheckpointEdit(): void;
	disarmCheckpointEdit(): void;
	submitCheckpointEdit(item: CheckpointItem): void;
};

export function createCheckpointEditor(input: {
	outcomeOf(requestId: ChatRequestId): ChatRequestOutcome | null;
	runs(): readonly RunGroup[];
	blocked(): boolean;
	openEditor(row: HTMLElement | null, mutate: () => Promise<void>): Promise<void>;
	resizeEditor(row: HTMLElement | null, mutate: () => void): void;
}): CheckpointEditor {
	const { runs, blocked, openEditor, resizeEditor } = input;
	const confirmation = createDestructiveConfirm({
		outcomeOf: input.outcomeOf,
		onAccepted: () => closeEditor(),
	});
	let editingCheckpointId = $state<string | null>(null);
	let editingPrompt = $state('');
	let checkpointEditor: HTMLTextAreaElement | null = $state(null);
	let editingRow: HTMLElement | null = null;

	function requestCheckpointEdit(item: CheckpointItem, target: EventTarget | null): void {
		if (target instanceof Element && target.closest('a, button')) return;
		const row = target instanceof Element ? target.closest<HTMLElement>('[data-prompt-row]') : null;
		void startCheckpointEdit(item, row);
	}

	async function startCheckpointEdit(item: CheckpointItem, row: HTMLElement | null): Promise<void> {
		const checkpointId = item.checkpointId;
		if (!checkpointId) return;
		confirmation.reset();
		editingRow = row;
		await openEditor(row, async () => {
			editingCheckpointId = checkpointId;
			editingPrompt = item.text;
			await tick();
			fitEditorToText();
		});
		checkpointEditor?.focus({ preventScroll: true });
		checkpointEditor?.setSelectionRange(editingPrompt.length, editingPrompt.length);
	}

	function fitEditorToText(): void {
		const editor = checkpointEditor;
		if (!editor) return;
		editor.style.height = '0px';
		editor.style.height = `${editor.scrollHeight}px`;
	}

	function autosizeCheckpointEditor(): void {
		resizeEditor(editingRow, fitEditorToText);
	}

	function closeEditor(): void {
		editingCheckpointId = null;
		editingPrompt = '';
		editingRow = null;
	}

	function cancelCheckpointEdit(): void {
		if (confirmation.state === 'submitting') return;
		closeEditor();
		confirmation.reset();
	}

	function submitCheckpointEdit(item: CheckpointItem): void {
		const checkpointId = item.checkpointId;
		if (!checkpointId || !editingPrompt.trim()) return;
		if (blocked()) return;

		confirmation.confirm({
			key: checkpointId,
			changeCount: () => fileChangesSinceCheckpoint(item, runs()),
			perform: (requestId) =>
				editCheckpointCommand({
					requestId,
					checkpointId,
					prompt: editingPrompt.trim(),
					contextFiles: item.contextFiles ?? [],
					attachments: item.attachments ?? [],
					issueReferences: item.issueReferences ?? [],
					transcriptReferences: item.transcriptReferences ?? [],
					elementReferences: item.elementReferences ?? [],
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
		get editingPrompt(): string {
			return editingPrompt;
		},
		set editingPrompt(value: string) {
			editingPrompt = value;
		},
		get element(): HTMLTextAreaElement | null {
			return checkpointEditor;
		},
		set element(value: HTMLTextAreaElement | null) {
			checkpointEditor = value;
		},
		isEditing: (item) => Boolean(item.checkpointId) && editingCheckpointId === item.checkpointId,
		isArmed: (item) => confirmation.isArmed(item.checkpointId),
		requestCheckpointEdit,
		autosizeCheckpointEditor,
		cancelCheckpointEdit,
		disarmCheckpointEdit: confirmation.disarm,
		submitCheckpointEdit,
	};
}
