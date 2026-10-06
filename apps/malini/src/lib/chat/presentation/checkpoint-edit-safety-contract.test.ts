import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const messageList = readChatMessageListSource(new URL('./', import.meta.url));

function slice(startMarker: string, endMarker: string): string {
	const start = messageList.indexOf(startMarker);
	expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
	const end = messageList.indexOf(endMarker, start + startMarker.length);
	expect(end, `missing ${endMarker} after ${startMarker}`).toBeGreaterThan(start);
	return messageList.slice(start, end);
}

describe('checkpoint edit destructive-path safety contract', () => {
	it('dispatches a destructive action from exactly one function', () => {
		expect(messageList.match(/request\.perform\(/gu)).toHaveLength(1);

		const confirm = slice('function confirm(request: DestructiveRequest)', '\n\treturn {');
		expect(confirm).toContain('request.perform(requestId);');
	});

	it('arms a confirmation before the first attempt can restore anything', () => {
		const confirm = slice('function confirm(request: DestructiveRequest)', '\n\treturn {');

		const guard = confirm.indexOf('if (armedKey !== request.key) {');
		const call = confirm.indexOf('request.perform(requestId);');
		expect(guard).toBeGreaterThan(-1);
		expect(call).toBeGreaterThan(guard);

		const unarmed = confirm.slice(guard, call);
		expect(unarmed).toContain('armedChangeCount = request.changeCount();');
		expect(unarmed).toContain('armedKey = request.key;');
		expect(unarmed).toContain('return false;');
		expect(unarmed).not.toContain('request.perform(');
	});

	it('reaches the destructive call from exactly one place per call site', () => {
		expect(messageList.match(/editCheckpointCommand\(\{/gu)).toHaveLength(1);
		const submit = slice('function submitCheckpointEdit(', '\n\treturn {');
		expect(submit).toContain('confirmation.confirm({');
		expect(submit.indexOf('perform: (requestId) =>')).toBeLessThan(
			submit.indexOf('editCheckpointCommand({'),
		);

		expect(messageList.match(/undoRunCommand\(\{/gu)).toHaveLength(1);
		const undo = slice('function undoThisTurn(', '\n\tfunction forkToNewChat');
		expect(undo).toContain('runUndo.confirm({');
		expect(undo.indexOf('perform: (requestId) =>')).toBeLessThan(undo.indexOf('undoRunCommand({'));
	});

	it('names the destructive effect rather than the mechanism', () => {
		const warning = slice('function checkpointRestoreWarning(', '\nexport type CheckpointEditor');
		expect(warning).toContain('Discards 1 file change made since this message');
		expect(warning).toContain('${changeCount} file changes made since this message');
		expect(warning).toContain('No file changes have been made since.');

		const undoWarning = slice('export function runUndoWarning(', '\n}');
		expect(undoWarning).toContain(
			'Discards 1 file change made since this turn, and every reply from this one on.',
		);
		expect(undoWarning).toContain(
			'Discards ${changeCount} file changes made since this turn, and every reply from this one on.',
		);

		const counter = slice('export function collectChangedPaths(', '\n}');
		expect(counter).toContain("candidate.kind === 'file'");
		expect(counter).toContain('mutationRepresentedByTool(candidate)');
		expect(counter).toContain('canonicalChangedPath(');
		expect(messageList).toContain('collectChangedPaths(paths, run.items, ownsItem ? item.seq');
		expect(messageList).toContain(
			'collectChangedPaths(paths, run.items, Number.NEGATIVE_INFINITY)',
		);
		expect(messageList.match(/export function fileChangesSinceCheckpoint\(/gu)).toHaveLength(1);
		const undoTarget = slice('export function runUndoTarget(', '\n}');
		expect(undoTarget).toContain('changeCount: fileChangesSinceCheckpoint(opening, runs)');

		expect(messageList).toContain('data-testid="chat-message-edit-confirm"');
		expect(messageList).toContain('{#if checkpointEdit.isArmed(item)}');
		expect(messageList).toContain('data-testid="chat-run-undo-warning"');
	});

	it('offers the destructive submit only while the confirmation is armed', () => {
		const footer = slice('{#if checkpointEdit.isArmed(item)}\n\t\t\t\t\t\t\t<Button', '</div>');
		expect(footer).toContain('data-testid="chat-message-edit-confirm-send"');
		expect(footer).toContain('Discard and send');
		expect(footer).toContain('{:else}');
		expect(footer).toContain('data-testid="chat-message-edit-send"');

		const undoControl = slice('{#if armed}', '\n</div>');
		const undoConfirm = undoControl.indexOf('data-testid="chat-run-undo-confirm"');
		const undoElse = undoControl.indexOf('{:else}');
		expect(undoConfirm).toBeGreaterThan(-1);
		expect(undoElse).toBeGreaterThan(undoConfirm);
		expect(undoControl.indexOf('data-testid="chat-run-undo-arm"')).toBeGreaterThan(undoElse);

		for (const marker of ['function cancelCheckpointEdit', 'async function startCheckpointEdit']) {
			const body = messageList.slice(messageList.indexOf(marker));
			expect(body.slice(0, body.indexOf('\n\t}'))).toContain('confirmation.reset()');
		}
		const dispatch = slice('const requestId = newChatRequestId();', 'return true;');
		expect(dispatch).toContain('armedKey = null;');
	});

	it('keeps Cmd+Enter routed through the same confirmation', () => {
		const editor = slice('data-testid="chat-message-editor"', '</form>');
		expect(editor).toContain("if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {");
		expect(editor).toContain('checkpointEdit.submitCheckpointEdit(item);');
		expect(editor).not.toContain('editCheckpointCommand(');
	});

	it('opens the editor from the bubble itself, and from nowhere else', () => {
		expect(messageList.match(/startCheckpointEdit\(item, row\)/gu)).toHaveLength(1);
		expect(messageList).not.toContain('data-testid="chat-message-edit-trigger"');

		const opener = slice(
			'function requestCheckpointEdit(',
			'\n\tasync function startCheckpointEdit',
		);
		expect(opener).toContain('void startCheckpointEdit(item, row);');
		expect(opener).toContain("target.closest('a, button')");

		const bubble = slice('{#if editable}', '{:else}');
		expect(bubble).toContain('data-testid="chat-message-bubble-user"');
		expect(bubble).toContain(
			'onclick={(event) => checkpointEdit.requestCheckpointEdit(item, event.target)}',
		);
		expect(bubble).toContain('role="button"');
		expect(bubble).toContain('tabindex="0"');
		expect(bubble).toContain("if (event.key !== 'Enter' && event.key !== ' ') return;");

		const inert = slice(
			'{:else}\n\t\t\t<div\n\t\t\t\tclass={[\n\t\t\t\t\tpromptBoxClass,',
			'{/if}',
		);
		expect(inert).toContain('data-testid="chat-message-bubble-user"');
		expect(inert).not.toContain('role=');
		expect(inert).not.toContain('tabindex');
		expect(inert).not.toContain('onclick');
	});

	it('offers undo only where there is something to undo, and not while a run is open', () => {
		const target = slice('export function runUndoTarget(', '\n}');
		expect(target).toContain('if (run.terminal === null) return null;');
		expect(target).toContain("item.kind === 'user'");
		expect(target).toContain('!opening.checkpointId');
		expect(target).toContain('if (runFileChanges(run) === 0) return null;');

		expect(messageList).toContain(
			'!run.superseded && !run.obsoleted ? runUndoTarget(run, runs) : null',
		);
		expect(messageList).toContain('<RunUndoFooter');
		expect(messageList).toContain('target={undoTarget}');
		expect(messageList).toContain('data-testid="chat-run-actions"');

		expect(messageList).toContain('disabled={blocked}');
		expect(messageList).toContain('disabled={busy || blocked}');
		expect(messageList).toContain('const blocked = $derived(transcript.workstreamRunInFlight);');
		expect(messageList).toContain("candidate.status === 'running'");
		expect(messageList).toContain("candidate.status === 'waiting_for_approval'");

		expect(messageList).toContain('checkOpenRunCommand(scope);');
		expect(messageList).toContain('return hasOpenRun(input.workstreamId());');
		expect(messageList).toContain(
			'const workstreamRunInFlight = $derived(locallyVisibleRunInFlight || nativeOpenRun.inFlight);',
		);
	});

	it('refuses the message-edit restore on the same guard, in the same words', () => {
		expect(
			messageList.match(/const blocked = \$derived\(transcript\.workstreamRunInFlight\);/gu),
		).toHaveLength(2);
		expect(messageList).toContain('blocked: () => workstreamRunInFlight,');

		expect(messageList).toContain('!blocked && !submitting && checkpointEdit.editingPrompt.trim()');
		expect(messageList.match(/disabled=\{!canSend\}/gu)).toHaveLength(2);
		expect(messageList).toContain('<Tooltip content={OPEN_RUN_BLOCKS_RESTORE}');
		expect(messageList.match(/OPEN_RUN_BLOCKS_RESTORE = /gu)).toHaveLength(1);

		const submit = slice('function submitCheckpointEdit(', '\n\treturn {');
		expect(submit.indexOf('if (blocked()) return;')).toBeGreaterThan(-1);
		expect(submit.indexOf('if (blocked()) return;')).toBeLessThan(
			submit.indexOf('confirmation.confirm({'),
		);
	});
});
