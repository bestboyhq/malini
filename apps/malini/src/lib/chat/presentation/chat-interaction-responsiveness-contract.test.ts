import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composer = readFileSync(new URL('./ChatComposer.svelte', import.meta.url), 'utf8');
const surface = readFileSync(new URL('./ChatSurface.svelte', import.meta.url), 'utf8');

describe('native chat interaction responsiveness', () => {
	it('snapshots every Send before it hands the prompt to the serial composer submission', () => {
		const submitStart = composer.indexOf('function submit(): void');
		const submitEnd = composer.indexOf('\n\tfunction continueTodoSubmission', submitStart);
		const submit = composer.slice(submitStart, submitEnd);
		const deliverStart = composer.indexOf('function deliver(submission: ComposerDelivery');
		const deliverEnd = composer.indexOf('\n\tfunction composerSnapshotIsCurrent', deliverStart);
		const deliver = composer.slice(deliverStart, deliverEnd);
		expect(submitStart).toBeGreaterThanOrEqual(0);
		expect(submitEnd).toBeGreaterThan(submitStart);
		expect(deliverStart).toBeGreaterThanOrEqual(0);
		expect(deliverEnd).toBeGreaterThan(deliverStart);
		const snapshotAt = submit.indexOf('const submission: ComposerDelivery = {');
		expect(snapshotAt).toBeGreaterThan(-1);
		expect(snapshotAt).toBeLessThan(submit.indexOf('resolveWorkstreamTodosCommand({'));
		expect(snapshotAt).toBeLessThan(submit.indexOf('deliver(submission, trimmed);'));
		const clearAt = deliver.indexOf("prompt = '';");
		expect(clearAt).toBeGreaterThan(-1);
		expect(clearAt).toBeLessThan(deliver.indexOf('submitComposerPromptCommand({'));
		expect(submit).not.toContain('if (submitting)');
		expect(deliver).not.toContain('if (submitting)');
		expect(deliver).toContain('draftPrompt: submission.prompt');
		expect(deliver).toContain('profile: submission.profile');
		expect(submit).toContain('\t\t\tsessionId,\n');
		expect(deliver).toContain('sessionId: submission.sessionId');
		expect(deliver).toContain('forceFreshSession: submission.forceFreshSession');
		expect(composer).toContain(
			"prompt.trim() !== '' && !disabled && agentUsable && !todoContextResolving",
		);
	});

	it('allows a fresh chat while another tab is running', () => {
		expect(surface).not.toContain('disabled={isRunning}');
		expect(surface).toContain('onnewchat={startFreshChatCommand}');
	});

	it('keeps the current or cached transcript mounted while chat activation settles', () => {
		expect(surface).toContain(
			'activeSessionId={freshChat ? null : (pendingSessionId ?? sessionId)}',
		);
		expect(surface).toContain('sessionId={presentedSessionId}');
		expect(surface).toContain('envelopes={presentedTranscript.envelopes}');
		expect(surface).toContain('disabled={bootError !== null || presentationPending}');
	});

	it('restores composer focus after the context-picker close flush without waiting for paint', () => {
		const closeStart = composer.indexOf('function closeContextPicker');
		const closeEnd = composer.indexOf('\n\tfunction addContextFile', closeStart);
		const close = composer.slice(closeStart, closeEnd);
		expect(close).toContain('await tick();');
		expect(close).not.toContain('requestAnimationFrame');
		expect(close.indexOf('contextOpen = false;')).toBeLessThan(close.indexOf('tick()'));
	});
});
