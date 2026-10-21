import { describe, expect, it } from 'vitest';
import { readOutputLines } from './read-output';

describe('read output lines', () => {
	it('splits the line numbers a read prints from the file text, in either separator', () => {
		expect(readOutputLines('125\tconst a = 1;\n126\t\treturn a;')).toEqual([
			{ number: '125', text: 'const a = 1;' },
			{ number: '126', text: '\treturn a;' },
		]);
		expect(readOutputLines('     1→# Title\n     2→')).toEqual([
			{ number: '1', text: '# Title' },
			{ number: '2', text: '' },
		]);
	});

	it('drops the notes a read appends after the numbered lines', () => {
		expect(
			readOutputLines(
				'1\tkeep\n\n<system-reminder>\nWhenever you read a file…\n</system-reminder>',
			),
		).toEqual([{ number: '1', text: 'keep' }]);
	});

	it('keeps output without line numbers as plain lines', () => {
		expect(readOutputLines('just text\nmore')).toEqual([
			{ number: null, text: 'just text' },
			{ number: null, text: 'more' },
		]);
	});
});
