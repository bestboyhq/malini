import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentRunProfile } from '../agent-profile.js';
import {
	claudeAnswers,
	claudeQuestions,
	disallowedTools,
	permissionDescriptor,
	permissionModeFor,
	rememberedPermissions,
	sandboxFor,
} from './permissions.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-permissions-')));
const worktree = join(root, 'worktree');
const linkedWorktree = join(root, 'linked-worktree');
mkdirSync(join(worktree, 'src'), { recursive: true });
writeFileSync(join(worktree, 'src', 'app.ts'), '');
symlinkSync(worktree, linkedWorktree);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function profile(
	mode: AgentRunProfile['mode'],
	access: AgentRunProfile['access'],
): AgentRunProfile {
	return { effort: 'high', mode, access };
}

describe('run profile mapping', () => {
	it.each([
		[undefined, 'acceptEdits', true],
		[profile('agent', 'sandboxed'), 'acceptEdits', true],
		[profile('agent', 'auto'), 'auto', false],
		[profile('agent', 'full'), 'bypassPermissions', false],
		[profile('plan', 'full'), 'plan', false],
		[profile('plan', 'sandboxed'), 'plan', true],
	] as const)('%o runs in %s with sandbox %s', (runProfile, mode, sandboxed) => {
		expect(permissionModeFor(runProfile)).toBe(mode);
		expect(sandboxFor(runProfile).enabled).toBe(sandboxed);
	});

	it('lets sandboxed shell commands run without asking', () => {
		expect(sandboxFor(undefined)).toEqual({ enabled: true, autoAllowBashIfSandboxed: true });
	});

	it('refuses the git and pull request commands malini owns', () => {
		expect(disallowedTools()).toEqual(
			expect.arrayContaining(['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr create:*)']),
		);
	});
});

describe('permissionDescriptor', () => {
	it('keeps reads and edits inside the worktree in the workstream boundary', () => {
		expect(permissionDescriptor('Read', { file_path: 'src/app.ts' }, worktree, undefined)).toEqual({
			capability: 'read',
			resources: [{ kind: 'path', value: 'src/app.ts', boundary: 'workstream' }],
		});
		expect(
			permissionDescriptor('Write', { file_path: join(worktree, 'new.ts') }, worktree, undefined),
		).toMatchObject({ capability: 'write', resources: [{ boundary: 'workstream' }] });
	});

	it('keeps a new file inside a symlinked worktree in the workstream boundary', () => {
		expect(
			permissionDescriptor(
				'Write',
				{ file_path: join(linkedWorktree, 'docs', 'README.md') },
				linkedWorktree,
				undefined,
			),
		).toMatchObject({ capability: 'write', resources: [{ boundary: 'workstream' }] });
	});

	it('flags a path outside the worktree with its canonical location', () => {
		expect(
			permissionDescriptor('Edit', { file_path: '../outside.txt' }, worktree, undefined),
		).toEqual({
			capability: 'write',
			resources: [
				{
					kind: 'path',
					value: '../outside.txt',
					boundary: 'external',
					canonicalValue: join(root, 'outside.txt'),
				},
			],
		});
	});

	it('describes the path Claude Code was blocked on rather than the tool input', () => {
		expect(
			permissionDescriptor('Read', { file_path: 'src/app.ts' }, worktree, '/etc/hosts'),
		).toMatchObject({ resources: [{ value: '/etc/hosts', boundary: 'external' }] });
	});

	it('describes commands, web access, MCP servers and other tools', () => {
		expect(permissionDescriptor('Bash', { command: 'pnpm test' }, worktree, undefined)).toEqual({
			capability: 'execute',
			resources: [{ kind: 'command', value: 'pnpm test', boundary: 'unknown' }],
		});
		expect(
			permissionDescriptor('WebFetch', { url: 'https://example.com' }, worktree, undefined),
		).toEqual({
			capability: 'network',
			resources: [{ kind: 'url', value: 'https://example.com', boundary: 'external' }],
		});
		expect(
			permissionDescriptor('mcp__linear__create_issue', { title: 'Bug' }, worktree, undefined),
		).toEqual({
			capability: 'external-service',
			resources: [{ kind: 'service', value: 'linear', boundary: 'external' }],
		});
		expect(permissionDescriptor('Skill', {}, worktree, undefined)).toEqual({
			capability: 'execute',
			resources: [{ kind: 'tool', value: 'Skill', boundary: 'unknown' }],
		});
	});
});

describe('rememberedPermissions', () => {
	const suggestions = [
		{ type: 'setMode', mode: 'acceptEdits', destination: 'userSettings' },
	] as const;

	it('remembers an approval for the rest of the session only', () => {
		expect(rememberedPermissions([...suggestions], 'session')).toEqual([
			{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
		]);
		expect(rememberedPermissions([...suggestions], 'workstream')).toEqual([
			{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
		]);
	});

	it('remembers nothing for a one-time approval or without suggestions', () => {
		expect(rememberedPermissions([...suggestions], 'once')).toBeUndefined();
		expect(rememberedPermissions(undefined, 'session')).toBeUndefined();
		expect(rememberedPermissions([], 'session')).toBeUndefined();
	});
});

describe('AskUserQuestion mapping', () => {
	const input = {
		questions: [
			{
				question: 'Which color do you prefer?',
				header: 'Color',
				options: [
					{ label: 'Red', description: 'The color red' },
					{ label: 'Blue', description: 'The color blue' },
				],
				multiSelect: false,
			},
			{
				question: 'Which sizes?',
				options: [{ label: 'S' }, { label: 'M' }],
				multiSelect: true,
			},
		],
	};

	it('turns Claude questions into answerable malini questions', () => {
		expect(claudeQuestions(input)).toEqual([
			{
				id: 'q0',
				prompt: 'Which color do you prefer?',
				header: 'Color',
				options: [
					{ label: 'Red', description: 'The color red' },
					{ label: 'Blue', description: 'The color blue' },
				],
				multiSelect: false,
				allowFreeText: true,
			},
			{
				id: 'q1',
				prompt: 'Which sizes?',
				options: [{ label: 'S' }, { label: 'M' }],
				multiSelect: true,
				allowFreeText: true,
			},
		]);
		expect(claudeQuestions({})).toEqual([]);
	});

	it('answers each question by its text, joining multiple choices', () => {
		const questions = claudeQuestions(input);
		expect(
			claudeAnswers(questions, [
				{ questionId: 'q0', values: ['Red'] },
				{ questionId: 'q1', values: ['S', 'M'] },
			]),
		).toEqual({ 'Which color do you prefer?': 'Red', 'Which sizes?': 'S, M' });
		expect(claudeAnswers(questions, [{ questionId: 'q0', values: ['Blue'] }])).toEqual({
			'Which color do you prefer?': 'Blue',
			'Which sizes?': '',
		});
	});
});
