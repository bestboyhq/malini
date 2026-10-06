import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { agentInteractions } from './agent-interactions.service';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform();
	platform.define('chat.decide-approval', async () => ({
		decision: 'allow',
		scope: 'session',
		remembered: true,
		ruleId: 'rule-1',
	}));
	platform.define('chat.answer-question', async () => {});
	setPlatformForTest(platform);
	return platform;
}

afterEach(() => {
	setPlatformForTest(null);
});

describe('answering what the agent asked', () => {
	it('forwards the whole approval decision, permission included, and returns the host’s result', async () => {
		const platform = installPlatform();
		const decision = {
			sessionId: 'session-1',
			runId: 'run-1',
			approvalId: 'approval-1',
			decision: 'allow',
			scope: 'session',
			permission: {
				capability: 'read',
				resources: [
					{
						kind: 'path',
						value: '../reference',
						canonicalValue: '/repo/reference',
						boundary: 'external',
					},
				],
			},
		} as const;

		await expect(agentInteractions.decideAgentApproval(decision)).resolves.toEqual({
			decision: 'allow',
			scope: 'session',
			remembered: true,
			ruleId: 'rule-1',
		});

		expect(platform.calls).toEqual([{ command: 'chat.decide-approval', args: decision }]);
	});

	it('forwards the whole question answer', async () => {
		const platform = installPlatform();
		const answer = {
			sessionId: 'session-1',
			runId: 'run-1',
			questionId: 'question-1',
			answers: [{ questionId: 'question-1:0', values: ['Vitest'] }],
		};

		await agentInteractions.answerAgentQuestion(answer);

		expect(platform.calls).toEqual([{ command: 'chat.answer-question', args: answer }]);
	});
});
