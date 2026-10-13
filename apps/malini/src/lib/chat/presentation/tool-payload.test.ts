import { describe, expect, it } from 'vitest';
import { toolInputBlocks, toolOutputBlock } from './tool-payload';

describe('tool payload blocks', () => {
	it('lifts the code an edit carries out of its JSON, in the language of the file it edits', () => {
		const blocks = toolInputBlocks(
			{ file_path: 'src/app.svelte', old_string: 'let a = 1;', new_string: 'let a = 2;' },
			'src/app.svelte',
		);
		expect(blocks).toEqual([
			{ label: 'Input', code: '{\n  "file_path": "src/app.svelte"\n}', language: 'json' },
			{ label: 'old_string', code: 'let a = 1;', language: 'markup' },
			{ label: 'new_string', code: 'let a = 2;', language: 'markup' },
		]);
	});

	it('shows a command as shell and keeps a payload without code as one JSON block', () => {
		expect(toolInputBlocks({ command: 'git status' }, null)).toEqual([
			{ label: 'command', code: 'git status', language: 'shell' },
		]);
		expect(toolInputBlocks({ pattern: 'TODO', path: 'src' }, null)).toEqual([
			{ label: 'Input', code: '{\n  "pattern": "TODO",\n  "path": "src"\n}', language: 'json' },
		]);
	});

	it('shows text output as itself, in the language of the file a read returned', () => {
		expect(toolOutputBlock('1\tconst a = 1;', 'src/a.ts', true)).toEqual({
			label: 'Output',
			code: '1\tconst a = 1;',
			language: 'typescript',
		});
		expect(toolOutputBlock('File created', 'src/a.ts', false).language).toBeNull();
		expect(toolOutputBlock({ ok: true }, null, false)).toEqual({
			label: 'Output',
			code: '{\n  "ok": true\n}',
			language: 'json',
		});
	});
});
