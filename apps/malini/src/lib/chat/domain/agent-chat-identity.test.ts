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
		expect(deriveAgentChatActivity('running', false, 'commands')).toBe('in-progress');
		expect(deriveAgentChatActivity('running', true, 'commands')).toBe('in-progress');
		expect(deriveAgentChatActivity('idle', true, 'agents')).toBe('in-progress');
		expect(deriveAgentChatActivity('idle', true)).toBe('in-progress');
		expect(deriveAgentChatActivity('waiting_for_approval')).toBe('needs-approval');
		expect(deriveAgentChatActivity('failed')).toBe('failed');
	});

	it('asks before closing a chat whose agent would stop', () => {
		const activities: AgentChatActivity[] = [
			'idle',
			'in-progress',
			'in-background',
			'needs-approval',
			'failed',
		];
		expect(activities.filter(closingStopsAgent)).toEqual([
			'in-progress',
			'in-background',
			'needs-approval',
		]);
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

	it('names an automation transcript as an automation', () => {
		expect(
			agentChatIdentity({
				displayName: 'Fix checks',
				model: null,
				status: 'running',
				origin: 'automation',
			}).name,
		).toBe('Automation: Fix checks');
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
