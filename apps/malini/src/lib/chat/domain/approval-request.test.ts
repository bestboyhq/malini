import { describe, expect, it } from 'vitest';
import type { AgentPermissionDescriptor } from './agent-interaction';
import {
	approvalHeadline,
	approvalReason,
	approvalShortTarget,
	approvalTargets,
	maliniToolApproval,
} from './approval-request';

const externalRead: AgentPermissionDescriptor = {
	capability: 'read',
	resources: [
		{
			kind: 'path',
			value: '../notes/README.md',
			canonicalValue: '/Users/me/notes/README.md',
			boundary: 'external',
		},
	],
};

const command: AgentPermissionDescriptor = {
	capability: 'execute',
	resources: [{ kind: 'command', value: 'touch /opt/probe', boundary: 'unknown' }],
};

describe('approval request', () => {
	it('states what Claude wants to do from the permission it asks for', () => {
		expect(approvalHeadline('Read', externalRead)).toBe('Claude wants to read a file');
		expect(approvalHeadline('Write', { ...externalRead, capability: 'write' })).toBe(
			'Claude wants to edit a file',
		);
		expect(approvalHeadline('Bash', command)).toBe('Claude wants to run a command');
		expect(
			approvalHeadline('WebSearch', {
				capability: 'network',
				resources: [{ kind: 'url', value: 'svelte runes', boundary: 'external' }],
			}),
		).toBe('Claude wants to search the web');
		expect(
			approvalHeadline('SandboxNetworkAccess', {
				capability: 'network',
				resources: [{ kind: 'url', value: 'example.com', boundary: 'external' }],
			}),
		).toBe('Claude wants to reach the network');
		expect(
			approvalHeadline('mcp__linear__create_issue', {
				capability: 'external-service',
				resources: [{ kind: 'service', value: 'linear', boundary: 'external' }],
			}),
		).toBe('Claude wants to use linear');
		expect(
			approvalHeadline('Task', {
				capability: 'execute',
				resources: [{ kind: 'tool', value: 'Task', boundary: 'unknown' }],
			}),
		).toBe('Claude wants to use Task');
		expect(approvalHeadline(undefined, undefined)).toBe('Claude wants to use a tool');
	});

	it('shows the exact resolved target and a short name for the settled line', () => {
		expect(approvalTargets(externalRead)).toEqual([
			{ kind: 'path', value: '/Users/me/notes/README.md' },
		]);
		expect(approvalTargets(command)).toEqual([{ kind: 'command', value: 'touch /opt/probe' }]);
		expect(approvalShortTarget('Read', externalRead)).toBe('README.md');
		expect(approvalShortTarget('Bash', command)).toBe('touch /opt/probe');
		expect(approvalShortTarget('Task', undefined)).toBe('Task');
	});

	it('keeps the reason only when it says why rather than repeating the prompt', () => {
		expect(approvalReason('Path is outside allowed working directories')).toBe(
			'Path is outside allowed working directories',
		);
		expect(approvalReason('Claude wants to use Write')).toBeNull();
		expect(approvalReason('  ')).toBeNull();
	});
});

describe('malini tool approval', () => {
	it('names the job and spells out what the user approves', () => {
		const names: Record<string, string> = { 'job-1': 'Update docs', draft: 'Open draft' };
		const lookup = {
			job: (reference: string): string => names[reference] ?? reference,
			workstream: (reference: string): string => reference,
		};
		expect(
			maliniToolApproval(
				'mcp__malini__jobs_run',
				{ job: 'job-1' },
				{ job: () => 'Update docs', workstream: (id) => id },
			)?.headline,
		).toBe('Run job ‘Update docs’');
		expect(
			maliniToolApproval(
				'mcp__malini__jobs_save',
				{
					name: 'Update docs',
					instructions: 'Read the diff.\nUpdate docs/.',
					runsIn: 'new-workstream',
					when: 'on pull-requests:ship-changed where merged is set',
					then: 'draft',
				},
				lookup,
			),
		).toEqual({
			headline: 'Save job ‘Update docs’',
			details: [
				{ label: 'Runs in', value: 'A new workstream' },
				{ label: 'When', value: 'on pull-requests:ship-changed where merged is set' },
				{ label: 'Runs', value: 'Off until you turn it on in the Jobs page' },
				{ label: 'Then', value: 'Open draft' },
				{ label: 'Instructions', value: 'Read the diff.\nUpdate docs/.' },
			],
		});
		expect(
			maliniToolApproval('mcp__malini__jobs_save', { id: 'job-1', when: null, then: null }, lookup),
		).toEqual({
			headline: 'Save job ‘Update docs’',
			details: [
				{ label: 'When', value: 'Only when you run it' },
				{ label: 'Then', value: 'Nothing' },
			],
		});
		expect(maliniToolApproval('mcp__malini__jobs_run', { job: 'Update docs' })).toEqual({
			headline: 'Run job ‘Update docs’',
			details: [],
		});
		expect(
			maliniToolApproval(
				'mcp__malini__jobs_save',
				{ id: 'job-1', model: 'sonnet' },
				{ job: () => 'Lint', workstream: (id) => id },
			)?.headline,
		).toBe('Save job ‘Lint’');
		expect(
			maliniToolApproval(
				'mcp__malini__jobs_run',
				{ job: 'Merge', workstream: 'ws-1' },
				{ job: (reference) => reference, workstream: () => 'Docs pass' },
			),
		).toEqual({
			headline: 'Run job ‘Merge’',
			details: [{ label: 'In', value: 'Docs pass' }],
		});
		expect(
			maliniToolApproval('mcp__malini__repositories_hide', { repository: 'acme/site' }),
		).toEqual({
			headline: 'Hide ‘acme/site’',
			details: [{ label: 'Keeps', value: 'Its clone and workstreams, under Hidden' }],
		});
		expect(
			maliniToolApproval('mcp__malini__workstreams_create', {
				repository: 'acme/site',
				prompt: 'Fix the footer links',
			}),
		).toEqual({
			headline: 'Start a workstream in ‘acme/site’',
			details: [{ label: 'Prompt', value: 'Fix the footer links' }],
		});
		expect(
			maliniToolApproval('mcp__malini__workstreams_create', {
				repository: 'acme/site',
				prompt: 'Fix the footer links',
				base: 'v0.17.5',
			}),
		).toEqual({
			headline: 'Start a workstream in ‘acme/site’',
			details: [
				{ label: 'Base', value: 'v0.17.5' },
				{ label: 'Prompt', value: 'Fix the footer links' },
			],
		});
	});

	it('leaves every other tool to the generic card', () => {
		expect(maliniToolApproval('mcp__malini__browser_open', { url: 'x' })).toBeNull();
		expect(maliniToolApproval('mcp__linear__create_issue', { title: 'Bug' })).toBeNull();
		expect(maliniToolApproval('mcp__malini__jobs_run', undefined)).toBeNull();
	});
});
