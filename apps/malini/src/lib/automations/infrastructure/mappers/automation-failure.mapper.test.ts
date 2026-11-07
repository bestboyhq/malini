import { describe, expect, it } from 'vitest';
import { CommandError } from '$contract/command-failure';
import { AutomationFailureMapper } from './automation-failure.mapper';

function failure(kind: string | null, message: string): CommandError {
	return new CommandError({
		name: 'AutomationError',
		message,
		code: null,
		kind,
		command: 'automations.run',
	});
}

describe('an automation refusal in words', () => {
	it('names a missing automation or workstream without its id', () => {
		expect(
			AutomationFailureMapper.fromRaw(failure('not-found', 'Workstream `ws-signal` not found.'))
				.message,
		).toBe('It no longer exists. Reload the Automations page to see what is left.');
	});

	it('explains invalid input without the error code prefix', () => {
		expect(
			AutomationFailureMapper.fromRaw(failure('invalid-args', 'invalid args: name is blank'))
				.message,
		).toBe('Malini could not use that: name is blank');
	});

	it('passes any other failure through as it reads', () => {
		expect(AutomationFailureMapper.fromRaw(failure(null, 'The agent is offline.')).message).toBe(
			'The agent is offline.',
		);
		expect(AutomationFailureMapper.fromRaw('plain text').message).toBe('plain text');
	});
});
