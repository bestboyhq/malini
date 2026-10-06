import { describe, expect, it } from 'vitest';
import { ROUTINE_WHEN_PHRASES } from '$lib/routines/domain/routine-when-phrase';
import { validateRoutineWhenPhrase } from './routine-when-phrase';

describe('validateRoutineWhenPhrase', () => {
	it('accepts every phrase the form offers, with the compiled description', () => {
		const results = ROUTINE_WHEN_PHRASES.map((phrase) => validateRoutineWhenPhrase(phrase));
		expect(results).toEqual([
			{ ok: true, description: 'When this workstream is created' },
			{ ok: true, description: 'When a frontend resource becomes ready' },
			{ ok: true, description: 'When a frontend Docker resource becomes ready' },
		]);
	});

	it('rejects an empty phrase with an instruction, not a compiler error', () => {
		expect(validateRoutineWhenPhrase('   ')).toEqual({
			ok: false,
			message: 'Choose when the routine should run.',
		});
	});

	it('surfaces the compiler rejection for an unsupported phrase', () => {
		const result = validateRoutineWhenPhrase('when the moon is full');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('Unsupported extension automation trigger');
		}
	});
});
