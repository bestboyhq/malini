import { describe, expect, it } from 'vitest';
import { editDiffstat } from './edit-diffstat';

describe('editDiffstat', () => {
	it('counts a pure insertion as added lines only', () => {
		expect(
			editDiffstat({
				file_path: 'src/a.ts',
				old_string: 'const a = 1;',
				new_string: `const a = 1;\n${Array.from({ length: 9 }, (_, index) => `line ${index}`).join('\n')}`,
			}),
		).toEqual({ added: 9, removed: 0 });
	});

	it('counts a pure deletion as removed lines only', () => {
		expect(
			editDiffstat({ path: 'src/a.ts', oldText: 'keep\ndrop one\ndrop two', newText: 'keep' }),
		).toEqual({ added: 0, removed: 2 });
	});

	it('counts only the region that changed, not the context quoted around it', () => {
		expect(
			editDiffstat({
				old_string: 'a\nb\nWRONG\nd\ne',
				new_string: 'a\nb\nRIGHT\nd\ne',
			}),
		).toEqual({ added: 1, removed: 1 });
	});

	it('reads an empty replacement as a real deletion rather than a missing field', () => {
		expect(editDiffstat({ old_string: 'gone\naway', new_string: '' })).toEqual({
			added: 0,
			removed: 2,
		});
	});

	it('sums a multi-edit call into one magnitude for the row', () => {
		expect(
			editDiffstat({
				file_path: 'src/a.ts',
				edits: [
					{ old_string: 'one', new_string: 'one\ntwo' },
					{ old_string: 'three\nfour', new_string: 'three' },
				],
			}),
		).toEqual({ added: 1, removed: 1 });
	});

	it.each([
		['oldText/newText', { oldText: 'a', newText: 'a\nb' }],
		['oldString/newString', { oldString: 'a', newString: 'a\nb' }],
		['old_str/new_str', { old_str: 'a', new_str: 'a\nb' }],
	])('reads the %s spelling of the same edit', (_name, input) => {
		expect(editDiffstat(input)).toEqual({ added: 1, removed: 0 });
	});

	it('treats CRLF text as the same lines as LF text', () => {
		expect(editDiffstat({ old_string: 'a\r\nb', new_string: 'a\r\nb\r\nc' })).toEqual({
			added: 1,
			removed: 0,
		});
	});

	it('reports nothing for an edit that changed nothing', () => {
		expect(editDiffstat({ old_string: 'same\ntext', new_string: 'same\ntext' })).toBeNull();
	});

	it('reports nothing for a write, whose payload says nothing about the old file', () => {
		expect(editDiffstat({ file_path: 'src/a.ts', content: 'one\ntwo\nthree' })).toBeNull();
	});

	it.each([[undefined], [null], ['a string'], [42], [{}], [{ file_path: 'src/a.ts' }], [[1, 2]]])(
		'reports nothing for input %#, which carries no before and after',
		(input) => {
			expect(editDiffstat(input)).toBeNull();
		},
	);
});
