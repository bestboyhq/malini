import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunGroup } from './render-state';
import { linearizeRunTimeline } from './run-timeline';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const messages = readChatMessageListSource(new URL('./', import.meta.url));
const bashCall = readFileSync(new URL('./BashToolCall.svelte', import.meta.url), 'utf8');

describe('inline Bash tool calls', () => {
	it('keeps one detailed shell tool in the linear conversation and removes its bridge duplicate', () => {
		const run: RunGroup = {
			runId: 'run-shell',
			superseded: false,
			obsoleted: false,
			terminal: 'completed',
			terminalText: 'done',
			items: [
				{
					kind: 'tool',
					key: 'tool-shell',
					seq: 2,
					tool: {
						name: 'Bash',
						startedAt: 10,
						completedAt: 20,
						input: { command: 'pnpm test' },
						output: 'green',
						status: 'completed',
					},
				},
				{
					kind: 'command',
					key: 'bridge-shell',
					seq: 3,
					command: 'pnpm test',
					output: 'green',
					exitCode: 0,
				},
				{ kind: 'assistant', key: 'answer', seq: 4, text: 'Tests pass.' },
			],
		};

		expect(
			linearizeRunTimeline(run, []).map((item) => ({ kind: item.kind, key: item.key })),
		).toEqual([
			{ kind: 'tool', key: 'tool-shell' },
			{ kind: 'assistant', key: 'answer' },
		]);
		expect(messages).toContain('<BashToolCall');
		expect(messages).toContain('operationName={displayNameFromTool(item)}');
		expect(messages).toContain('operationName="Shell"');
	});

	it("leads a shell row with the agent's own label and keeps the command beside it", () => {
		expect(messages).toContain('description={descriptionFromTool(item)}');
		expect(messages).toContain('description={item.description ?? null}');
		expect(bashCall).toContain('{#if description}');
		expect(bashCall).toContain('data-bash-description');
		expect(bashCall).toContain('<SensitiveText text={command} />');
		expect(bashCall).toContain('<SensitiveText text={activityLabel} />');
	});

	it('renders the same row elements whether or not a command is running', () => {
		const row = bashCall.slice(
			bashCall.indexOf('data-message-kind="bash"'),
			bashCall.indexOf("{#if status === 'failed'}"),
		);
		const statusBranches = row.match(/\{#if [^}]*status[^}]*\}/gu) ?? [];
		expect(statusBranches).toEqual([]);
	});

	it('syntax-colors the command inside the disclosure', () => {
		expect(bashCall).toMatch(/<CodeTokens\s+code=\{command\}\s+language="shell"\s*\/>/u);
		expect(bashCall).toMatch(/<SensitiveText\s+text=\{outputText\}\s*\/><\/pre>/u);
	});

	it('states a shell failure on the row instead of hiding it behind the chevron', () => {
		expect(bashCall).toContain('data-testid="bash-command-failure"');
		expect(bashCall).toContain('<SensitiveText text={failureReason} />');
		expect(bashCall).toContain("{#if status === 'failed'}");
		expect(bashCall).toContain("toolFailureReason(error) ?? 'The command could not finish'");
		expect(bashCall).toContain('exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null');
		expect(bashCall).toContain('>{exitLabel}');
		expect(bashCall).not.toContain('>{failureLabel}');
		expect(messages).toContain('status={commandStatus(item)}');
		expect(messages).not.toContain("item.exitCode === 0 ? 'completed' : 'failed'");
	});

	it('toggles the disclosure in place and scrolls its managed output', () => {
		expect(bashCall).toContain('onclick={() => (expanded = !expanded)}');
		expect(bashCall).toContain('{#if expanded}');
		expect(bashCall).toContain('orientation="xy"');
		expect(bashCall).toContain('testId="command-output-scroll"');
	});
});
