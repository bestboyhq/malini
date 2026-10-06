import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const buffered = readFileSync(
	new URL('./BufferedStreamingMarkdown.svelte', import.meta.url),
	'utf8',
);
const bufferedText = readFileSync(
	new URL('./BufferedStreamingText.svelte', import.meta.url),
	'utf8',
);
const messages = readChatMessageListSource(new URL('./', import.meta.url));
const status = readFileSync(new URL('./RunStatusLine.svelte', import.meta.url), 'utf8');
const arrivalMotion = readFileSync(new URL('./arrival-motion.ts', import.meta.url), 'utf8');

describe('agent response arrival wiring', () => {
	it('buffers complete visual lines before animating them', () => {
		expect(buffered).toContain('nextCompleteVisualLineChunk');
		expect(buffered).toContain('latestSource = source');
		expect(buffered).not.toContain('source.slice(revealedLength)');
		expect(buffered).toContain('playbackCache');
		expect(buffered).toContain('visibleText = source');
		expect(buffered).toContain('data-buffered-characters');
		expect(messages).toContain('<BufferedStreamingMarkdown');
	});

	it('uses compact staged activity instead of opening raw thought text by default', () => {
		const liveThinking =
			messages.match(/<details[\s\S]*?data-testid="thinking-live"[\s\S]*?<\/details>/u)?.[0] ?? '';
		expect(liveThinking).not.toMatch(/<details\s+open/u);
		expect(liveThinking).toContain('data-testid="thinking-live-preview"');
		expect(liveThinking).toContain('thinkingPreview(block.text)');
		expect(liveThinking).toContain('<BufferedStreamingText text={block.text} />');
		expect(bufferedText).toContain('untrack(() =>');
		expect(bufferedText).toContain('intervalMs = 220');
		expect(messages).toContain(
			'use:stageEnter={blockKey(sessionId, block.runId, block.contentId)}',
		);
		expect(messages).toContain('function playArrival(');
		expect(status).toContain('deriveRunStatus');
		expect(status).toContain('<BusyIcon');
		expect(status).not.toContain('Tooltip');
		const openRun = messages.slice(
			messages.indexOf('{#if isLastRun && run.terminal === null}'),
			messages.indexOf("{#if run.terminal !== null && run.terminal !== 'completed'}"),
		);
		expect(openRun).toContain('<RunStatusLine');
		expect(openRun.lastIndexOf('<RunStatusLine')).toBeGreaterThan(
			openRun.lastIndexOf('data-testid="chat-message-bubble-live"'),
		);
	});

	it('stages in every kind of row, not only the two that stream', () => {
		const rowSites = messages.match(/use:stageEnter=/gu) ?? [];
		expect(rowSites.length).toBeGreaterThanOrEqual(12);
		for (const marker of [
			'data-message-kind="thinking"',
			'data-message-kind="plan"',
			'data-message-kind="assistant"',
			'data-message-kind="tool"',
			'data-message-kind="file"',
			'data-message-kind="terminal"',
			'data-message-kind="activity-group"',
		]) {
			const site = messages.lastIndexOf('use:stageEnter=', messages.indexOf(marker));
			expect(site, `${marker} never stages in`).toBeGreaterThan(-1);
			expect(messages.slice(site, messages.indexOf(marker))).not.toContain('>');
		}
		expect(messages).toContain(
			'<div class="w-full" use:stageEnter={timelineKey(run, item.key)}>\n\t\t<BashToolCall',
		);
	});

	it('withholds the stage-in from history and from bulk reveals', () => {
		expect(messages).toContain('let transcriptSettled = false;');
		expect(messages).toContain('const MAX_STAGED_PER_FRAME = 4;');
		expect(messages).toMatch(/if \(transcriptSettled && stagedThisFrame < MAX_STAGED_PER_FRAME\)/u);
		expect(messages).toMatch(
			/function resettleTranscript\(\)[\s\S]{0,300}transcriptSettled = true;/u,
		);
		expect(messages).toContain('use:stageEnter={timelineKey(run, item.contentId ?? item.key)}');
		expect(messages).toContain('use:stageEnter={timelineKey(run, item.contentId)}');
	});

	it('never animates a layout property in the transcript', () => {
		const arrival = messages.match(/function playArrival\([\s\S]*?\n\t\}/u)?.[0] ?? '';
		expect(arrival).not.toBe('');
		expect(arrival).toContain('transform:');
		expect(arrival).toContain('opacity:');
		for (const layoutProperty of ['height', 'padding', 'margin', 'top:', 'width']) {
			expect(arrival, layoutProperty).not.toContain(layoutProperty);
		}
		expect(messages).not.toContain('smoothGrow');
		expect(messages).not.toContain('node.style.height');

		expect(arrival).not.toContain('getBoundingClientRect');
		expect(arrival).not.toContain('getComputedStyle');
	});

	it('ships the tuned values, not the ones used to watch the motion', () => {
		expect(arrivalMotion).not.toContain('TEMPORARY');
		expect(arrivalMotion).toContain('exposeArrivalMotionForTuning');
		expect(messages).toContain('import.meta.env.DEV');
	});

	it('keeps the run status row compositable and holds it still for the whole run', () => {
		expect(status).not.toContain('background-clip: text');
		expect(status).not.toContain('run-status-shimmer');
		expect(status).not.toContain('run-status-pulse');

		expect(messages).toContain('<RunStatusLine {renderState} {waitingForUser} />');
		expect(messages).not.toContain('idle=');
		expect(status).not.toContain('MIN_VISIBLE_MS');
		expect(status).not.toContain('HIDE_DWELL_MS');
		expect(status).not.toContain('{#if visible}');
	});

	it('tracks only stream triggers while finalization and scroll pinning mutate reactive state', () => {
		expect(messages).toContain('currentEnvelopes.length;');
		expect(messages).toContain('currentStreamingProjector.takePendingEffects()');
		expect(messages).toContain('sessionProjectors.streaming.project(envelopes)');
		expect(messages).not.toContain('streamingCursorBySession');
		expect(messages).toContain('untrack(() => {');
		expect(messages).not.toContain(
			'untrack(() => pinLatestContentNow(updateLatestMessageSpacer()))',
		);
	});
});
