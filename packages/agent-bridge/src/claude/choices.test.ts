import { describe, expect, it } from 'vitest';
import { pickSchema, validPick } from './choices.js';

describe('validPick', () => {
	it('keeps a whole pick within the candidates', () => {
		expect(validPick({ pick: 1 }, 3)).toBe(1);
		expect(validPick({ pick: 3 }, 3)).toBe(3);
	});

	it('rejects a pick outside the candidates or of another shape', () => {
		expect(validPick({ pick: 0 }, 3)).toBeNull();
		expect(validPick({ pick: 4 }, 3)).toBeNull();
		expect(validPick({ pick: 1.5 }, 3)).toBeNull();
		expect(validPick({ pick: '2' }, 3)).toBeNull();
		expect(validPick([2], 3)).toBeNull();
		expect(validPick(null, 3)).toBeNull();
	});

	it('asks Claude Code for exactly one whole pick within the candidates', () => {
		expect(pickSchema(4)).toEqual({
			type: 'object',
			properties: { pick: { type: 'integer', minimum: 1, maximum: 4 } },
			required: ['pick'],
			additionalProperties: false,
		});
	});
});
