import { afterEach, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { FakeBridge } from '$shared/port/fake/fake-bridge';
import { setPlatformForTest } from '$shared/port/platform';
import { AgentInteractionCommands } from './agent-interactions.aggregate.svelte';

const permission = {
	capability: 'read',
	resources: [
		{
			kind: 'path',
			value: '../repositories',
			canonicalValue: '/app-data/repositories',
			boundary: 'external',
		},
	],
} as const;

afterEach(() => setPlatformForTest(null));

it('sends an approval taken from the live transcript across the platform boundary', async () => {
	const bridge = new FakeBridge();
	bridge.define('chat.decide-approval', ({ decision, scope }) => ({
		decision,
		scope,
		remembered: false,
	}));
	setPlatformForTest(bridge);
	const transcript: EventEnvelope[] = $state([
		{
			sessionId: 'session-1',
			runId: 'run-1',
			seq: 1,
			event: {
				type: 'approval.requested',
				runId: 'run-1',
				approvalId: 'approval-1',
				reason: 'Read outside this workstream',
				permission,
			},
		},
	]);
	const commands = new AgentInteractionCommands(undefined, () => {});
	commands.sync(transcript);

	await expect(
		commands.decideApproval({
			sessionId: 'session-1',
			runId: 'run-1',
			approvalId: 'approval-1',
			decision: 'allow',
			scope: 'once',
		}),
	).resolves.toBe(true);
	expect(bridge.calls).toEqual([
		{
			command: 'chat.decide-approval',
			args: {
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
				permission,
			},
		},
	]);
});
