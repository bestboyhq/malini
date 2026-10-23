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
		const jobName = (reference: string): string => names[reference] ?? reference;
		expect(
			maliniToolApproval('mcp__malini__jobs_run', { job: 'job-1' }, () => 'Update docs')?.headline,
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
				jobName,
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
			maliniToolApproval(
				'mcp__malini__jobs_save',
				{ id: 'job-1', when: null, then: null },
				jobName,
			),
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
			maliniToolApproval('mcp__malini__jobs_save', { id: 'job-1', model: 'sonnet' }, () => 'Lint')
				?.headline,
		).toBe('Save job ‘Lint’');
		expect(maliniToolApproval('mcp__malini__pull_requests_open_draft', {})).toEqual({
			headline: 'Open a draft pull request',
			details: [{ label: 'When', value: 'Once this turn ends' }],
		});
	});

	it('leaves every other tool to the generic card', () => {
		expect(maliniToolApproval('mcp__malini__browser_open', { url: 'x' })).toBeNull();
		expect(maliniToolApproval('mcp__linear__create_issue', { title: 'Bug' })).toBeNull();
		expect(maliniToolApproval('mcp__malini__jobs_run', undefined)).toBeNull();
	});
});
