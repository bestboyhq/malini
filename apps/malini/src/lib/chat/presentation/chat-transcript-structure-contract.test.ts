import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const messageList = readChatMessageListSource(new URL('./', import.meta.url));
const toolCard = readFileSync(new URL('./ToolCard.svelte', import.meta.url), 'utf8');
const bashCall = readFileSync(new URL('./BashToolCall.svelte', import.meta.url), 'utf8');
const runTimeline = readFileSync(new URL('./run-timeline.ts', import.meta.url), 'utf8');
const incrementalRunTimeline = readFileSync(
	new URL('./incremental-run-timeline.ts', import.meta.url),
	'utf8',
);
const chatSurface = readFileSync(new URL('./ChatSurface.svelte', import.meta.url), 'utf8');
describe('agent transcript structure and selection contract', () => {
	it('lets the composer communicate successful completion without a redundant transcript row', () => {
		expect(messageList).not.toContain("run.terminal === 'completed'");
		expect(messageList).not.toContain('data-terminal="completed"');
		expect(messageList).not.toContain('Run completed');
		expect(messageList).toContain("run.terminal !== 'completed'");
	});

	it('makes transcript chrome non-selectable while message content remains copyable', () => {
		expect(chatSurface).toContain('select-none');
		expect(messageList).toContain('data-testid="chat-message-list"');
		expect(messageList).toContain('<BufferedStreamingMarkdown');
		expect(messageList).toContain('text={item.text}');
		expect(messageList).toContain('class="select-text"');
		expect(messageList).toContain('data-testid="chat-run-error-text"');
	});

	it('lets a stray drag across the chrome paint nothing', () => {
		for (const [file, name, end] of [
			[toolCard, 'ToolCard', '{#if expanded}'],
			[bashCall, 'BashToolCall', "{#if status === 'failed'}"],
		] as const) {
			const row = file.slice(0, file.indexOf(end));
			expect(row, `${name} row`).not.toContain('select-text');
		}
		expect(toolCard.match(/select-text/g)).toHaveLength(2);
		expect(toolCard).toContain('data-testid="tool-card-json"');
		expect(bashCall).toMatch(/select-text"\s*><SensitiveText\s+text=\{outputText\}\s*\/><\/pre>/u);
		expect(bashCall).toMatch(/select-text"\s*>\s*<SensitiveText\s+text=\{failureReason\}\s*\/>/u);

		const bubbleStart = messageList.indexOf('{#if editable}');
		expect(bubbleStart).toBeGreaterThan(-1);
		const bubble = messageList.slice(bubbleStart, messageList.indexOf('{/if}', bubbleStart));
		expect(bubble.match(/promptBoxClass,/g)).toHaveLength(2);
		expect(bubble).not.toContain('select-text');
		const promptBox = messageList.slice(
			messageList.indexOf('const promptBoxClass ='),
			messageList.indexOf('</script>', messageList.indexOf('const promptBoxClass =')),
		);
		expect(promptBox).toContain('select-none');

		expect(messageList).not.toContain('data-message-pending');
		expect(messageList).not.toContain('chat-pending-prompt');
	});

	it('always renders the complete assistant response without a collapse affordance', () => {
		expect(messageList).toContain('text={item.text}');
		expect(messageList).toContain('complete={true}');
		expect(messageList).not.toContain('LONG_MESSAGE_PREVIEW_CHARS');
		expect(messageList).not.toContain('Show full response');
		expect(messageList).not.toContain('Collapse response');
		expect(messageList).not.toContain('chat-toggle-long-message');
	});

	it('keeps tool input and output code explicitly selectable', () => {
		expect(toolCard.match(/select-text/g)).toHaveLength(2);
		expect(toolCard).toContain('bind:open={expanded}');
		expect(toolCard).toContain('{#if expanded}');
		expect(toolCard.indexOf('{#if expanded}')).toBeLessThan(
			toolCard.indexOf('data-testid="tool-card-json"'),
		);
		expect(toolCard).toContain('data-testid="tool-card-json"');
		expect(toolCard).toContain('data-tool-output');
	});

	it('keeps the precise provider tool name during streamed input', () => {
		expect(messageList).toContain('name: pending.name,');
		expect(messageList).not.toContain('name="Tool"');
	});

	it('draws a call still streaming its input as a row of the run it belongs to', () => {
		expect(messageList).toContain(
			'key: stableToolKey(openRunId, pending.name, pending.toolCallId, 0),',
		);
		expect(messageList).toContain('mergePendingToolRows(runRows, livePendingToolItems)');
		expect(messageList).not.toContain('{#each livePendingToolInputs as pending');
		expect(messageList).toContain('const drawn = new Set(rows.map((row) => row.key));');
		expect(messageList).toContain('pending.filter((row) => !drawn.has(row.key))');
	});

	it('folds history into activity groups while the newest run stays a linear loop', () => {
		expect(messageList).toContain('if (isLastRun) return window.items;');
		expect(messageList).toMatch(/groupRunTimeline\(window\.items\)/u);
		expect(messageList).toContain(
			'{@const runRows = groupedTimelineItems(run, runTimelineWindow, isLastRun)}',
		);
		expect(messageList).toContain('data-testid="chat-activity-group-failed"');
		expect(messageList).toContain('{#each group.failures as failure (failure.key)}');
		expect(messageList).toContain('{failure.message}');
		expect(messageList).toContain('<Icon name="warning"');
		expect(messageList).toContain('{#if !expandedActivityGroups[group.key]}');
		expect(messageList).not.toMatch(/data-testid="chat-activity-group-failed"\s*>failed</u);
		expect(messageList).toContain('data-activity-status={group.status}');
		expect(messageList).toContain(`	interface Props {
		item: RunTimelineItem;
		run: RunGroup;
		isLastRun: boolean;
	}`);
		expect(messageList).toContain('<ChatTimelineRow {item} {run} {isLastRun} />');
		expect(messageList).toContain('<ChatTimelineRow item={child} {run} {isLastRun} />');
	});

	it('renders one linear agent loop without a second run-level activity wrapper', () => {
		expect(messageList).toContain('{#each runTimelineItems as item (item.key)}');
		expect(messageList).toContain('windowRunTimeline(');
		expect(messageList).toContain('{#each runs as run, runIndex (run.runId)}');
		expect(messageList).toContain('const INITIAL_RUN_TIMELINE_WINDOW_SIZE = 200;');
		expect(messageList).toContain('const RUN_TIMELINE_REVEAL_INCREMENT = 200;');
		expect(messageList).toMatch(
			/\[runId\]:\s+\(visibleTimelineLimitByRun\[runId\] \?\? INITIAL_RUN_TIMELINE_WINDOW_SIZE\) \+\s+RUN_TIMELINE_REVEAL_INCREMENT,/u,
		);
		expect(messageList).toMatch(
			/Show \{Math\.min\(RUN_TIMELINE_REVEAL_INCREMENT, runTimelineWindow\.hiddenCount\)\} older\s+events/u,
		);
		expect(messageList).toContain('data-transcript-presentation="all-runs-timeline-window"');
		expect(messageList).toContain('data-transcript-mounted-runs={runs.length}');
		expect(messageList).toContain('data-transcript-mounted-items={runTimelineWindow.items.length}');
		expect(messageList).not.toContain('chat-show-older-runs');
		expect(messageList).not.toContain('showOlderRuns');
		expect(messageList).not.toContain('visibleRunLimit');
		expect(messageList).toMatch(
			/sessionProjectors\.timeline\.project\(\s*run,\s*finalizedThinkingForRun\(run\.runId\)/u,
		);
		expect(incrementalRunTimeline).toContain('runProjectionChangesSince');
		expect(incrementalRunTimeline).toContain('linearizeRunTimeline(run, thoughts)');
		expect(messageList).not.toContain('RunActivity');
		expect(messageList).not.toContain('Worked for');
		expect(messageList).not.toContain('run-activity-summary');
		expect(runTimeline).toContain('left.seq - right.seq');
		expect(runTimeline).toContain("item.kind === 'file'");
		expect(runTimeline).toContain("item.kind === 'command'");
	});

	it('puts the size of an edit on its row so nobody has to open it to find out', () => {
		expect(toolCard).toContain('editDiffstat(labelInput) : null');
		expect(toolCard).toContain('data-testid="tool-card-diffstat"');
		expect(toolCard).toContain('{#if diffstat.added > 0}');
		expect(toolCard).toContain('{#if diffstat.removed > 0}');
		expect(toolCard).toContain(
			'aria-label={`${diffstat.added} lines added, ${diffstat.removed} lines removed`}',
		);
	});

	it('keeps Bash calls inline while every other tool owns one detail disclosure', () => {
		expect(messageList).toContain(
			'const drawAsCommand = $derived(everCommand || isCommandTool(item));',
		);
		expect(messageList).toContain('{#if drawAsCommand}');
		expect(messageList).toContain('<BashToolCall');
		expect(messageList).toContain('<ToolCard');
		expect(toolCard).toContain("${expanded ? 'Hide' : 'Show'} input and output for ${displayName}");
		expect(toolCard).toContain('summarizeLiveToolInput(liveInputJson)');
		expect(toolCard).toContain(
			"toolActivityLabel(name, labelInput, waiting ? 'completed' : status)",
		);
		expect(toolCard).toContain('toolDisplayName(name, labelInput)');
	});
});
