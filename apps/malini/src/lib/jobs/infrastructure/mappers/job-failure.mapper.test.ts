import { describe, expect, it } from 'vitest';
import { CommandError } from '$contract/command-failure';
import { JobFailureMapper } from './job-failure.mapper';

function failure(kind: string | null, message: string): CommandError {
	return new CommandError({ name: 'JobError', message, code: null, kind, command: 'jobs.run' });
}

describe('a job refusal in words', () => {
	it('names a missing job or workstream without its id', () => {
		expect(
			JobFailureMapper.fromRaw(failure('not-found', 'Workstream `ws-signal` not found.')).message,
		).toBe('It no longer exists. Reload the Jobs page to see what is left.');
	});

	it('explains invalid input without the error code prefix', () => {
		expect(
			JobFailureMapper.fromRaw(failure('invalid-args', 'invalid args: name is blank')).message,
		).toBe('Malini could not use that: name is blank');
	});

	it('passes any other failure through as it reads', () => {
		expect(JobFailureMapper.fromRaw(failure(null, 'The agent is offline.')).message).toBe(
			'The agent is offline.',
		);
		expect(JobFailureMapper.fromRaw('plain text').message).toBe('plain text');
	});
});
