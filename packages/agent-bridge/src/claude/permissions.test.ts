import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentRunProfile } from '../agent-profile.js';
import {
	approvedInput,
	autoModeCategory,
	autoModeRule,
	claudeAnswers,
	claudeQuestions,
	disallowedTools,
	maliniOwnedCommand,
	permissionDescriptor,
	permissionModeFor,
	rememberedPermissions,
	sandboxFor,
	steerToMalini,
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
		[undefined, 'auto', false],
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
		expect(sandboxFor(profile('agent', 'sandboxed'))).toMatchObject({
			enabled: true,
			autoAllowBashIfSandboxed: true,
		});
	});

	it('lets sandboxed commands reach GitHub, its Actions logs, and verify certificates', () => {
		const network = sandboxFor(profile('agent', 'sandboxed')).network;
		expect(network?.allowedDomains).toEqual(
			expect.arrayContaining([
				'github.com',
				'api.github.com',
				'productionresultssa0.blob.core.windows.net',
				'productionresultssa19.blob.core.windows.net',
			]),
		);
		expect(network?.allowedDomains).not.toContain('*.blob.core.windows.net');
		expect(network?.allowMachLookup).toEqual(['com.apple.trustd.agent']);
	});

	it("lets sandboxed commands serve on localhost so malini's browser can open their pages", () => {
		expect(sandboxFor(profile('agent', 'sandboxed')).network?.allowLocalBinding).toBe(true);
	});

	it('refuses the git and pull request commands malini owns', () => {
		expect(disallowedTools()).toEqual(
			expect.arrayContaining([
				'Bash(git commit:*)',
				'Bash(git push:*)',
				'Bash(gh pr create:*)',
				'Bash(gh pr merge:*)',
				'Bash(git stash)',
				'Bash(git stash -*)',
				'Bash(git stash pop:*)',
			]),
		);
	});

	it('lets agents read the stash and restore files', () => {
		expect(disallowedTools()).not.toContain('Bash(git stash:*)');
		expect(disallowedTools()).not.toContain('Bash(git restore:*)');
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
			permissionDescriptor('SandboxNetworkAccess', { host: 'example.com' }, worktree, undefined),
		).toEqual({
			capability: 'network',
			resources: [{ kind: 'url', value: 'example.com', boundary: 'external' }],
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

	it('names the job a malini tool saves or runs', () => {
		const descriptor = (tool: string, input: Record<string, unknown>) =>
			permissionDescriptor(`mcp__malini__${tool}`, input, worktree, undefined);

		expect(descriptor('jobs_save', { name: 'Update docs', instructions: 'Read the diff' })).toEqual(
			{
				capability: 'write',
				resources: [{ kind: 'tool', value: 'Save job ‘Update docs’', boundary: 'workstream' }],
			},
		);
		expect(descriptor('jobs_run', { job: 'Update docs' })).toEqual({
			capability: 'execute',
			resources: [{ kind: 'tool', value: 'Run job ‘Update docs’', boundary: 'workstream' }],
		});
		expect(descriptor('repositories_hide', { repository: 'acme/site' })).toEqual({
			capability: 'write',
			resources: [{ kind: 'tool', value: 'Hide repository ‘acme/site’', boundary: 'workstream' }],
		});
		expect(descriptor('workstreams_create', { repository: 'acme/site' })).toEqual({
			capability: 'write',
			resources: [
				{ kind: 'tool', value: 'Start a workstream in ‘acme/site’', boundary: 'workstream' },
			],
		});
		expect(descriptor('repositories_list', {})).toEqual({
			capability: 'external-service',
			resources: [{ kind: 'service', value: 'malini', boundary: 'external' }],
		});
	});
});

describe('a call auto mode blocked', () => {
	it('names the narrowest rule Claude Code can match it with', () => {
		expect(autoModeRule('Bash', { command: 'printf "(x)" > out.txt' }, worktree)).toBe(
			'Bash(printf "\\(x\\)" > out.txt)',
		);
		expect(autoModeRule('WebFetch', { url: 'https://docs.example.com/a?b=1' }, worktree)).toBe(
			'WebFetch(domain:docs.example.com)',
		);
		expect(autoModeRule('Edit', { file_path: 'src/a.ts' }, worktree)).toBe(
			`Edit(/${join(worktree, 'src/a.ts')})`,
		);
		expect(autoModeRule('mcp__ops__set_member_role', { org: 'acme' }, worktree)).toBe(
			'mcp__ops__set_member_role',
		);
		expect(autoModeRule('Bash', {}, worktree)).toBe('Bash');
	});

	it('reads the category out of the reason auto mode gives', () => {
		expect(autoModeCategory('[Account & Standing-Rule Changes]')).toBe(
			'Account & Standing-Rule Changes',
		);
		expect(autoModeCategory('judged dangerous')).toBe('judged dangerous');
		expect(autoModeCategory(undefined)).toBe('no reason given');
	});
});

describe('rememberedPermissions', () => {
	const suggestions = [
		{ type: 'setMode', mode: 'acceptEdits', destination: 'userSettings' },
	] as const;

	it('remembers an approval for the rest of the session only', () => {
		expect(rememberedPermissions('Read', [...suggestions], 'session')).toEqual([
			{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
		]);
		expect(rememberedPermissions('Read', [...suggestions], 'workstream')).toEqual([
			{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
		]);
	});

	it('remembers nothing for a one-time approval or without suggestions', () => {
		expect(rememberedPermissions('Read', [...suggestions], 'once')).toBeUndefined();
		expect(rememberedPermissions('Read', undefined, 'session')).toBeUndefined();
		expect(rememberedPermissions('Read', [], 'session')).toBeUndefined();
	});

	it('leaves remembering a Malini action to Malini, so Claude Code never allows the whole tool', () => {
		const rule: PermissionUpdate[] = [
			{
				type: 'addRules',
				rules: [{ toolName: 'mcp__malini__jobs_run' }],
				behavior: 'allow',
				destination: 'localSettings',
			},
		];
		for (const scope of ['session', 'workstream', 'everywhere'] as const) {
			expect(rememberedPermissions('mcp__malini__jobs_run', rule, scope)).toBeUndefined();
		}
	});
});

describe('approvedInput', () => {
	const input = { id: 'job-1', instructions: 'Agent text' };
	const edited = { id: 'job-1', instructions: 'Reviewed text' };

	it('hands a Malini tool the version the user reviewed', () => {
		expect(approvedInput('mcp__malini__jobs_save', input, edited)).toEqual(edited);
		expect(approvedInput('mcp__malini__jobs_save', input, undefined)).toBe(input);
	});

	it('never lets a reply rewrite any other tool', () => {
		const command = { command: 'ls' };
		expect(approvedInput('Bash', command, { command: 'rm -rf /' })).toBe(command);
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

describe('maliniOwnedCommand', () => {
	it('finds a malini-owned git command behind options, prefixes and other commands', () => {
		expect(maliniOwnedCommand('git -C /tmp/repo commit --allow-empty -m probe')).toBe('git commit');
		expect(maliniOwnedCommand('cd app && git push origin HEAD')).toBe('git push');
		expect(maliniOwnedCommand('GIT_EDITOR=true git -c user.name=a rebase main')).toBe('git rebase');
		expect(maliniOwnedCommand('env git stash')).toBe('git stash');
		expect(maliniOwnedCommand('gh pr create --fill')).toBe('gh pr create');
		expect(maliniOwnedCommand('gh pr merge 12 --squash')).toBe('gh pr merge');
	});

	it('leaves reads and quoted text alone', () => {
		expect(maliniOwnedCommand('git -C /tmp/repo status --short')).toBeNull();
		expect(maliniOwnedCommand('git log --oneline -5 | head')).toBeNull();
		expect(maliniOwnedCommand('git stash list')).toBeNull();
		expect(maliniOwnedCommand('echo "git commit"')).toBeNull();
		expect(maliniOwnedCommand('grep -rn -E "refuse|git checkout|worktree" apps')).toBeNull();
		expect(maliniOwnedCommand('gh pr view 12')).toBeNull();
		expect(maliniOwnedCommand('git worktree list')).toBeNull();
	});

	it('owns every worktree change', () => {
		expect(maliniOwnedCommand('git worktree add -q --detach ../fork v0.17.5 && cd ../fork')).toBe(
			'git worktree',
		);
		expect(maliniOwnedCommand('git worktree remove ../fork')).toBe('git worktree');
	});
});

describe('steerToMalini', () => {
	async function steer(command: string) {
		const output = await steerToMalini(
			{
				hook_event_name: 'PreToolUse',
				session_id: 'session',
				transcript_path: '/tmp/transcript.jsonl',
				cwd: worktree,
				tool_name: 'Bash',
				tool_input: { command },
				tool_use_id: 'tool-use',
			},
			'tool-use',
			{ signal: new AbortController().signal },
		);
		return 'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined;
	}

	it('points a refused branch or worktree change at a new workstream', async () => {
		for (const command of [
			'git checkout -q -b fix/language v0.17.5',
			'git worktree add ../fork v0.17.5',
		]) {
			expect(await steer(command)).toMatchObject({
				permissionDecision: 'deny',
				permissionDecisionReason: expect.stringContaining('`workstreams_create`'),
			});
		}
	});

	it('points a refused commit at the Open draft job and rules out workarounds', async () => {
		const output = await steer('git commit -am fix');
		expect(output).toMatchObject({ permissionDecision: 'deny' });
		expect(output).toMatchObject({
			permissionDecisionReason: expect.stringContaining('Open draft or Merge job'),
		});
		expect(output).toMatchObject({ permissionDecisionReason: expect.stringContaining('gh api') });
	});

	it('lets a clone run and tells the agent to change its code in a workstream', async () => {
		for (const command of [
			'git clone https://github.com/acme/fork /tmp/fork',
			'gh repo clone acme/fork',
			'gh repo fork upstream/lib --clone',
		]) {
			const output = await steer(command);
			expect(output).not.toHaveProperty('permissionDecision');
			expect(output).toMatchObject({
				additionalContext: expect.stringContaining('`repositories_clone`'),
			});
		}
		expect(await steer('git status')).toBeUndefined();
	});
});
