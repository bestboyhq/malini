import { describe, expect, it } from 'vitest';
import {
	backgroundAgentSummary,
	shellCommandLabel,
	summarizeLiveToolInput,
	toolActionKind,
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
	toolFailureReason,
	shellExitCode,
	withoutShellExit,
} from './tool-display-name';

describe('toolDisplayName', () => {
	it.each([
		['Read', 'Read'],
		['Edit', 'Edit'],
		['Bash', 'Bash'],
		['WebSearch', 'Web Search'],
		['TodoWrite', 'Todo Write'],
	])('keeps canonical tool identity %s as %s', (raw, expected) => {
		expect(toolDisplayName(raw)).toBe(expected);
	});

	it.each([
		['mcp__computer-use__screenshot', 'Computer Use · Screenshot'],
		['mcp__codebase-memory-mcp__search_graph', 'Codebase Memory · Search Graph'],
		['mcp__node_repl__js', 'Node REPL · JavaScript'],
		['mcp__acme_runtime__acme_runtime_deploy_widget', 'Acme Runtime · Deploy Widget'],
		['mcp__github__create_issue', 'GitHub · Create Issue'],
	])('removes protocol syntax from %s without losing its operation', (raw, expected) => {
		expect(toolDisplayName(raw)).toBe(expected);
	});

	it('names a result whose tool call never arrived as an unknown operation', () => {
		expect(toolDisplayName('')).toBe('Unknown operation');
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

	it('names the page or element a browser call acts on', () => {
		expect(
			toolActivityLabel(
				'mcp__malini__browser_open',
				{ url: 'http://localhost:4100/docs' },
				'running',
			),
		).toBe('Malini · Browser Open · localhost:4100/docs');
		expect(
			toolActivityLabel(
				'mcp__malini__browser_click',
				{ selector: 'a[href="#retry-after"]' },
				'completed',
			),
		).toBe('Malini · Browser Click · a[href="#retry-after"]');
		expect(
			toolActivityLabel(
				'mcp__malini__browser_type',
				{ selector: 'input[name=search]', text: 'rate limits', submit: true },
				'completed',
			),
		).toBe('Malini · Browser Type · input[name=search]');
		expect(toolActivityLabel('mcp__malini__browser_screenshot', {}, 'completed')).toBe(
			'Malini · Browser Screenshot',
		);
	});

	it('reads the action kind from the tool identity', () => {
		expect(toolActionKind('Bash', { command: 'git status' })).toBe('command');
		expect(toolActionKind('mcp__malini__browser_open')).toBe('read');
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

describe('shell command labels', () => {
	const root = '/Users/me/Library/Application Support/malini/workstreams/01JABC';

	it('leads with what ran rather than where it ran', () => {
		expect(shellCommandLabel(`cd "${root}" && pnpm format && pnpm lint`)).toBe(
			'pnpm format && pnpm lint',
		);
		expect(shellCommandLabel(`cd '${root}/apps/x'; cd src\ngrep -n hatch "${root}/a.ts"`)).toBe(
			'grep -n hatch "a.ts"',
		);
		expect(shellCommandLabel('cd apps/malini && pnpm test')).toBe('pnpm test');
	});

	it('keeps a bare cd as it is', () => {
		expect(shellCommandLabel(`cd "${root}"`)).toBe('cd .');
		expect(shellCommandLabel('pnpm build && cd out')).toBe('pnpm build && cd out');
	});

	it('names the command in the activity summary the same way', () => {
		expect(toolActivityLabel('Bash', { command: `cd "${root}" && git status` }, 'completed')).toBe(
			'Bash · git status',
		);
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

describe('shell exit codes', () => {
	it("reads the exit code Claude Code puts before a shell command's output", () => {
		expect(shellExitCode('Exit code 1\nsrc/a.ts:3: match')).toBe(1);
		expect(shellExitCode('Exit code 127')).toBe(127);
	});

	it.each([
		[null],
		[''],
		['command timed out'],
		['Exit code reported by the tool'],
		['grep: Exit code 1 seen'],
	])('reads no exit code from %p', (error) => {
		expect(shellExitCode(error)).toBeNull();
	});

	it('drops the exit code line and keeps what the command printed', () => {
		expect(withoutShellExit('Exit code 1\nsrc/a.ts:3: match')).toBe('src/a.ts:3: match');
		expect(withoutShellExit('Exit code 1')).toBeNull();
		expect(withoutShellExit('command timed out')).toBe('command timed out');
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
