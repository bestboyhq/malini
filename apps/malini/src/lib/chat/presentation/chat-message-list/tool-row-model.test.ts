import { describe, expect, it } from 'vitest';
import type { RenderItem } from '../render-state';
import {
	commandFromTool,
	failureTextFromTool,
	liveCommandText,
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

describe('the command a row was given', () => {
	it('reads the command a call carries, trimmed', () => {
		expect(liveCommandText({ command: '  pnpm test  ' })).toBe('pnpm test');
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
