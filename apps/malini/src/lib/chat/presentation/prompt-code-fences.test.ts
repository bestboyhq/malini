import { describe, expect, it } from 'vitest';
import { promptCodeFences } from './prompt-code-fences';

describe('prompt code fences', () => {
	it('cuts a closed fence out of the prompt, keeping every character', () => {
		const text = 'Fix this:\n```ts\nconst a = 1;\n```\nthanks';
		const parts = promptCodeFences(text);
		expect(parts).toEqual([
			{ kind: 'text', text: 'Fix this:\n' },
			{ kind: 'code', open: '```ts\n', code: 'const a = 1;', language: 'ts', close: '\n```' },
			{ kind: 'text', text: '\nthanks' },
		]);
		expect(
			parts
				.map((part) => (part.kind === 'text' ? part.text : part.open + part.code + part.close))
				.join(''),
		).toBe(text);
	});

	it('shows prose as it was typed, without the escapes markdown wrote around it', () => {
		expect(promptCodeFences('Use \\`\\`\\`ts fences and \\*stars\\* in C:\\\\tmp')).toEqual([
			{ kind: 'text', text: 'Use ```ts fences and *stars* in C:\\tmp' },
		]);
	});

	it('leaves an unclosed fence as text', () => {
		expect(promptCodeFences('```ts\nconst a = 1;')).toEqual([
			{ kind: 'text', text: '```ts\nconst a = 1;' },
		]);
	});
});
