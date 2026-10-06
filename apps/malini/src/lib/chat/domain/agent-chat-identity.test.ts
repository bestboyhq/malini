import { describe, expect, it } from 'vitest';
import { agentChatIdentity, deriveAgentChatActivity } from './agent-chat-identity';

describe('agent chat identity', () => {
	it('maps run lifecycle to the four icon states used by chat navigation', () => {
		expect(deriveAgentChatActivity('idle')).toBe('idle');
		expect(deriveAgentChatActivity('completed')).toBe('idle');
		expect(deriveAgentChatActivity('running')).toBe('in-progress');
		expect(deriveAgentChatActivity('idle', true)).toBe('in-progress');
		expect(deriveAgentChatActivity('waiting_for_approval')).toBe('needs-approval');
		expect(deriveAgentChatActivity('failed')).toBe('failed');
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

	it('keeps raw provider diagnostics out of compact sidebar status labels', () => {
		expect(
			agentChatIdentity({
				displayName: 'Check OpenCode billing',
				model: 'opencode/grok-4.5',
				status: 'failed',
				lastError: '{"type":"error","error":{"data":{"message":"Insufficient balance"}}}',
			}),
		).toMatchObject({
			name: 'Check OpenCode billing',
			activity: 'failed',
			statusLabel: 'Last run failed',
		});
	});
});
