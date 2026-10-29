import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { recordedMessages, type RecordedScenario } from './fixtures/fake-claude.js';
import { RunFailureSignals } from './run-failure.js';

function failureOf(messages: readonly SDKMessage[]): ReturnType<RunFailureSignals['failure']> {
	const signals = new RunFailureSignals();
	for (const message of messages) signals.accept(message);
	const result = messages
		.filter((message): message is SDKResultMessage => message.type === 'result')
		.at(-1);
	if (!result) throw new Error('the messages have no result');
	return signals.failure(result);
}

function recorded(scenario: RecordedScenario): ReturnType<RunFailureSignals['failure']> {
	return failureOf(recordedMessages(scenario));
}

describe('RunFailureSignals', () => {
	it('tells what failed from what Claude Code reported', () => {
		expect(recorded('usageLimit')).toEqual({
			kind: 'usage-limit',
			resetsAt: '2026-10-27T14:31:13.000Z',
			status: 429,
		});
		expect(recorded('rateLimit')).toEqual({ kind: 'rate-limit', status: 429 });
		expect(recorded('overloaded')).toEqual({ kind: 'overloaded', status: 529 });
		expect(recorded('serverError')).toEqual({ kind: 'server-error', status: 500 });
		expect(recorded('network')).toEqual({ kind: 'network' });
		expect(recorded('signedOut')).toEqual({ kind: 'sign-in', status: 401 });
		expect(recorded('billing')).toEqual({ kind: 'billing', status: 400 });
		expect(recorded('promptTooLong')).toEqual({ kind: 'request', status: 400 });
	});

	it('waits for a usage limit only when Claude Code says when it resets', () => {
		const withoutReset = recordedMessages('usageLimit')
			.filter((message) => message.type !== 'rate_limit_event')
			.map((message) =>
				message.type === 'assistant' ? { ...message, api_error_params: undefined } : message,
			);

		expect(failureOf(withoutReset)).toEqual({ kind: 'billing', status: 429 });
	});

	it('names the error a turn ended on, even after a rejected limit earlier in it', () => {
		const limit = recordedMessages('usageLimit').filter(
			(message) => message.type === 'rate_limit_event',
		);

		expect(failureOf([...limit, ...recordedMessages('serverError')])).toEqual({
			kind: 'server-error',
			status: 500,
		});
	});
});
