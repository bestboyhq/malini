import { describe, expect, it } from 'vitest';
import {
	agentChatIdentity,
	closingStopsAgent,
	deriveAgentChatActivity,
	type AgentChatActivity,
} from './agent-chat-identity';

describe('agent chat identity', () => {
	it('maps run lifecycle to the icon states used by chat navigation', () => {
		expect(deriveAgentChatActivity('idle')).toBe('idle');
		expect(deriveAgentChatActivity('completed')).toBe('idle');
		expect(deriveAgentChatActivity('running')).toBe('in-progress');
		expect(deriveAgentChatActivity('running', false, 'agents')).toBe('in-background');
		expect(deriveAgentChatActivity('running', false, 'commands')).toBe('commands-running');
		expect(deriveAgentChatActivity('running', true, 'commands')).toBe('in-progress');
		expect(deriveAgentChatActivity('idle', true, 'agents')).toBe('in-progress');
		expect(deriveAgentChatActivity('idle', true)).toBe('in-progress');
		expect(deriveAgentChatActivity('waiting_for_approval')).toBe('needs-approval');
		expect(deriveAgentChatActivity('failed')).toBe('failed');
	});

	it('asks before closing a chat whose agent or background commands would stop', () => {
		const activities: AgentChatActivity[] = [
			'idle',
			'in-progress',
			'in-background',
			'commands-running',
			'needs-approval',
			'failed',
		];
		expect(activities.filter(closingStopsAgent)).toEqual([
			'in-progress',
			'in-background',
			'commands-running',
			'needs-approval',
		]);
	});

	it('names a chat that only waits on its background commands without calling it busy', () => {
		expect(
			agentChatIdentity({
				displayName: 'Serve the app',
				model: null,
				status: 'running',
				backgroundWait: 'commands',
			}),
		).toMatchObject({ activity: 'commands-running', statusLabel: 'Background commands running' });
	});

	it('keeps provider and model as metadata instead of using them as the name', () => {
		expect(
			agentChatIdentity({
				displayName: 'Fix login refresh',
				model: 'claude-sonnet-4-6',
				status: 'running',
			}),
		).toEqual({
			name: 'Fix login refresh',
			activity: 'in-progress',
			statusLabel: 'Working',
			model: 'claude-sonnet-4-6',
		});
	});

	it('names a job transcript as a job', () => {
		expect(
			agentChatIdentity({
				displayName: 'Fix checks',
				model: null,
				status: 'running',
				origin: 'job',
			}).name,
		).toBe('Job: Fix checks');
	});

	it('keeps raw provider diagnostics out of compact sidebar status labels', () => {
		expect(
			agentChatIdentity({
				displayName: 'Check API billing',
				model: 'opus',
				status: 'failed',
				lastError: '{"type":"error","error":{"data":{"message":"Insufficient balance"}}}',
			}),
		).toMatchObject({
			name: 'Check API billing',
			activity: 'failed',
			statusLabel: 'Last run failed',
		});
	});
});
