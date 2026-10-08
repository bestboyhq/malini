import { describe, expect, it } from 'vitest';
import type { AgentPermissionDescriptor } from './agent-interaction';
import {
	approvalHeadline,
	approvalReason,
	approvalShortTarget,
	approvalTargets,
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
		expect(approvalTargets(externalRead)).toEqual(['/Users/me/notes/README.md']);
		expect(approvalTargets(command)).toEqual(['touch /opt/probe']);
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
