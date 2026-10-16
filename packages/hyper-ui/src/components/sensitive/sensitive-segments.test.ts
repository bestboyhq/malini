import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sensitiveMasking } from './sensitive-masking.svelte';
import { hasSensitiveText, sensitiveSegments, sensitiveSegmentsAcross } from './sensitive-segments';

beforeEach(() => {
	sensitiveMasking.on = true;
});

afterEach(() => {
	sensitiveMasking.on = false;
});

function masked(text: string): string {
	return sensitiveSegments(text)
		.map((segment) => (segment.kind ? `[${segment.kind}]` : segment.text))
		.join('');
}

describe('sensitive segments', () => {
	it('masks email addresses and the user name in home directory paths', () => {
		expect(masked('Signed in as ada.l+dev@example.co.uk · Claude Max')).toBe(
			'Signed in as [email] · Claude Max',
		);
		expect(masked('Write · /Users/ada/conductor/x.ts and /home/bob/.ssh')).toBe(
			'Write · /Users/[user]/conductor/x.ts and /home/[user]/.ssh',
		);
		expect(masked('file:///Users/ada')).toBe('file:///Users/[user]');
		expect(hasSensitiveText('mail ada@example.com')).toBe(true);
		expect(masked('mail ada@example.com')).toBe('mail [email]');
	});

	it('leaves remotes, scoped packages and plain text alone', () => {
		for (const text of [
			'git@github.com:bestboyhq/malini.git',
			'@anthropic-ai/claude-agent-sdk',
			'/var/folders/zn/T/malini-e2e',
			'Users/ada is not a path',
		]) {
			expect(masked(text)).toBe(text);
			expect(hasSensitiveText(text)).toBe(false);
		}
	});

	it('splits a match that spans several parts into pieces of one match', () => {
		const pieces = sensitiveSegmentsAcross(['cd /Users/a', 'da/src', ' ok']);
		expect(pieces.map((segments) => segments.map(({ text, kind }) => [text, kind]))).toEqual([
			[
				['cd /Users/', null],
				['a', 'user'],
			],
			[
				['da', 'user'],
				['/src', null],
			],
			[[' ok', null]],
		]);
		expect(pieces[0]?.[1]?.match).toBe(pieces[1]?.[0]?.match);
	});

	it('masks nothing while masking is off', () => {
		sensitiveMasking.on = false;
		const text = 'Signed in as ada@example.com · /Users/ada/notes.md';
		expect(masked(text)).toBe(text);
		expect(hasSensitiveText(text)).toBe(false);
	});
});
