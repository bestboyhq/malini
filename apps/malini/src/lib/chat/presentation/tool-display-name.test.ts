import { describe, expect, it } from 'vitest';
import {
	backgroundAgentSummary,
	summarizeLiveToolInput,
	toolActionKind,
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
	toolFailureReason,
} from './tool-display-name';

describe('toolDisplayName', () => {
	it.each([
		['Read', 'Read'],
		['Edit', 'Edit'],
		['Bash', 'Bash'],
		['apply_patch', 'apply_patch'],
		['computer-use', 'Computer Use'],
	])('keeps canonical tool identity %s as %s', (raw, expected) => {
		expect(toolDisplayName(raw)).toBe(expected);
	});

	it.each([
		['mcp__computer-use__computer_use', 'Computer Use'],
		['mcp__codebase-memory-mcp__search_graph', 'Codebase Memory · Search Graph'],
		['mcp__node_repl__js', 'Node REPL · JavaScript'],
		['mcp__acme_runtime__acme_runtime_deploy_widget', 'Acme Runtime · Deploy Widget'],
		['functions.apply_patch', 'apply_patch'],
		['github/create_issue', 'GitHub · Create Issue'],
	])('removes protocol syntax from %s without losing its operation', (raw, expected) => {
		expect(toolDisplayName(raw)).toBe(expected);
	});

	it('humanizes an unknown identity instead of collapsing it to a generic label', () => {
		expect(toolDisplayName('acme_runtime/deploy_widget_v2')).toBe(
			'Acme Runtime · Deploy Widget V2',
		);
	});

	it.each([
		[{ command: 'pnpm test' }, 'Bash'],
		[{ patch: '*** Begin Patch' }, 'apply_patch'],
		[{ pattern: 'tool.started' }, 'Search'],
		[{ path: 'src/app.ts', old_string: 'a', new_string: 'b' }, 'Edit'],
		[{ action: 'click' }, 'Computer Use · Click'],
		[{ tool: 'mcp__linear__get_issue' }, 'Linear · Get Issue'],
	])('recovers a missing provider identity from structured input %#', (input, expected) => {
		expect(toolDisplayName('Tool', input)).toBe(expected);
	});

	it('uses an honest deterministic fallback when the provider omitted every identity signal', () => {
		for (const generic of ['Tool', 'tool_call', 'ToolCall', 'tool use', 'Function Call']) {
			const label = toolDisplayName(generic);
			expect(label).toBe('Unknown operation');
			expect(label.toLowerCase()).not.toContain('tool');
		}
	});

	it('keeps the concrete computer-use action in the real provider identity', () => {
		expect(toolDisplayName('mcp__computer-use__computer_use', { action: 'double_click' })).toBe(
			'Computer Use · Double Click',
		);
	});
});

describe('tool transcript labels', () => {
	it('always keeps the precise tool identity beside file and command context', () => {
		expect(toolActivityLabel('Read', { path: 'src/main.ts' }, 'running')).toBe(
			'Read · src/main.ts',
		);
		expect(toolActivityLabel('Bash', { command: 'pnpm test' }, 'running')).toBe('Bash · pnpm test');
		expect(toolActivityLabel('Write', { file: 'src/output.ts' }, 'completed')).toBe(
			'Write · src/output.ts',
		);
	});

	it('uses the inferred identity for generic streamed input', () => {
		expect(toolActivityLabel('Tool', { action: 'scroll' }, 'running')).toBe(
			'Running Computer Use · Scroll',
		);
		expect(toolActionKind('Tool', { command: 'git status' })).toBe('command');
	});
});

describe("the agent's own label for a shell call", () => {
	it('returns the imperative label the bash call carried', () => {
		expect(
			toolDescriptionLabel('Bash', {
				command: "grep -rn 'BashRunResult' agent-bridge/src",
				description: 'Check BashRunResult import',
			}),
		).toBe('Check BashRunResult import');
	});

	it('recognizes a shell call whose provider identity only lives in its input', () => {
		expect(
			toolDescriptionLabel('Tool', { command: 'ls', description: 'List the workstream' }),
		).toBe('List the workstream');
	});

	it('never promotes a description field on an unrelated tool to a row headline', () => {
		expect(
			toolDescriptionLabel('mcp__linear__create_issue', {
				title: 'Fix the crash',
				description: 'A long issue body that is not a label for this call.',
			}),
		).toBeNull();
		expect(
			toolDescriptionLabel('Edit', { file_path: 'src/a.ts', description: 'a docstring' }),
		).toBeNull();
	});

	it('falls back to nothing when the call carried no label', () => {
		expect(toolDescriptionLabel('Bash', { command: 'pnpm test' })).toBeNull();
		expect(toolDescriptionLabel('Bash', { command: 'pnpm test', description: '   ' })).toBeNull();
	});

	it('keeps a runaway label to one line the row can hold', () => {
		const label = toolDescriptionLabel('Bash', {
			command: 'pnpm test',
			description: `${'word '.repeat(80)}\nsecond line`,
		});
		expect(label).not.toBeNull();
		expect(label).toHaveLength(118);
		expect(label?.endsWith('…')).toBe(true);
	});
});

describe('tool failure reasons', () => {
	it('keeps the reason and leaves the printed output behind', () => {
		expect(toolFailureReason('command timed out\nstdout:\nrunning 402 tests\nstderr:\n')).toBe(
			'command timed out',
		);
	});

	it('skips leading blank lines rather than reporting an empty reason', () => {
		expect(toolFailureReason('\n\n  command not found\nmore')).toBe('command not found');
	});

	it.each([[null], [undefined], [''], ['   \n  ']])('reports no reason for %p', (error) => {
		expect(toolFailureReason(error)).toBeNull();
	});

	it('caps a single runaway line so a failure row stays a row', () => {
		const reason = toolFailureReason('x'.repeat(400));
		expect(reason).toHaveLength(240);
		expect(reason?.endsWith('…')).toBe(true);
	});
});

describe('streamed tool input summaries', () => {
	it('recovers a command and path from complete or partial live JSON', () => {
		expect(summarizeLiveToolInput('{"command":"pnpm test"}')).toEqual({
			command: 'pnpm test',
		});
		expect(summarizeLiveToolInput('{"file_path":"src/app.ts","content":"unfinished')).toEqual({
			file_path: 'src/app.ts',
		});
	});

	it('bounds work for a very large streamed edit while retaining its early path', () => {
		const input = `{"path":"src/large.ts","content":"${'x'.repeat(100_000)}`;
		expect(summarizeLiveToolInput(input)).toEqual({ path: 'src/large.ts' });
	});
});

describe('background agents', () => {
	const input = { description: 'Sleep probe', run_in_background: true, prompt: 'sleep 15' };

	it('names the agent by its task while it runs and by its result once it reports', () => {
		expect(toolDisplayName('Agent', input)).toBe('Background agent');
		expect(toolDescriptionLabel('Agent', input)).toBe('Sleep probe');
		expect(toolActivityLabel('Agent', input, 'running')).toBe('Background agent');
		expect(backgroundAgentSummary('Agent', input, undefined)).toBeNull();
		expect(backgroundAgentSummary('Agent', input, '\nCommand completed.\n\nprobe-done')).toBe(
			'Command completed.',
		);
	});

	it('leaves a foreground agent as it was', () => {
		const foreground = { description: 'Explore', prompt: 'look around' };
		expect(toolDisplayName('Agent', foreground)).toBe('Agent');
		expect(toolActivityLabel('Agent', foreground, 'running')).toBe('Running Agent');
		expect(backgroundAgentSummary('Agent', foreground, 'done')).toBeNull();
	});
});
