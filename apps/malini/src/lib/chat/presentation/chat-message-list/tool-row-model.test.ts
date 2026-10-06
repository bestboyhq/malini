import { describe, expect, it } from 'vitest';
import type { RenderItem } from '../render-state';
import {
	commandFromTool,
	commandStatus,
	failureTextFromTool,
	liveCommandText,
	type CommandItem,
	type ToolItem,
} from './tool-row-model';

function toolItem(tool: Partial<ToolItem['tool']>): ToolItem {
	return {
		kind: 'tool',
		key: 'tool-1',
		seq: 1,
		tool: {
			name: 'Bash',
			startedAt: 0,
			completedAt: 10,
			input: {},
			output: null,
			status: 'completed',
			...tool,
		},
	};
}

function commandItem(fields: Partial<CommandItem>): CommandItem {
	return {
		kind: 'command',
		key: 'cmd-1',
		seq: 1,
		command: 'pnpm test',
		exitCode: 0,
		output: null,
		...fields,
	};
}

describe('the command a row was given', () => {
	it('reads either field the providers use, trimmed', () => {
		expect(liveCommandText({ command: '  pnpm test  ' })).toBe('pnpm test');
		expect(liveCommandText({ cmd: 'ls -la' })).toBe('ls -la');
	});

	it('prefers `command` when a call carries both', () => {
		expect(liveCommandText({ command: 'first', cmd: 'second' })).toBe('first');
	});

	it('has no answer for input that is still arriving', () => {
		expect(liveCommandText(undefined)).toBeNull();
		expect(liveCommandText('a bare string')).toBeNull();
		expect(liveCommandText({})).toBeNull();
		expect(liveCommandText({ command: '   ' })).toBeNull();
		expect(liveCommandText({ command: 42 })).toBeNull();
	});

	it('draws a persisted call from the same field as its streaming copy', () => {
		expect(commandFromTool(toolItem({ input: { command: 'git status' } }))).toBe('git status');
	});
});

describe('whether a shell row reads as failed', () => {
	it('is still running while the exit code is unknown', () => {
		expect(commandStatus(commandItem({ exitCode: null }))).toBe('running');
	});

	it('completed a non-zero exit that reported no error', () => {
		expect(commandStatus(commandItem({ exitCode: 1 }))).toBe('completed');
		expect(commandStatus(commandItem({ exitCode: 127 }))).toBe('completed');
	});

	it('failed only when the call itself carried an error', () => {
		expect(commandStatus(commandItem({ exitCode: 1, error: 'command not found' }))).toBe('failed');
		expect(commandStatus(commandItem({ exitCode: 0, error: 'timed out' }))).toBe('failed');
	});
});

describe('what a failed tool row says', () => {
	it('uses the error the call reported', () => {
		expect(failureTextFromTool(toolItem({ status: 'failed', error: 'ENOENT' }))).toBe('ENOENT');
	});

	it('still says something when the transport lost the text', () => {
		expect(failureTextFromTool(toolItem({ name: 'Read', input: {}, status: 'failed' }))).toContain(
			'failed',
		);
	});
});

describe('type guards', () => {
	it('narrows the projected union to the two kinds this module speaks for', () => {
		const item: RenderItem = toolItem({});
		expect(item.kind).toBe('tool');
	});
});
