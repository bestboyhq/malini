// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderSanitizedHtml } from './MarkdownText.svelte';

describe('inline markdown', () => {
	it('renders code, bold and links in one run of text, and an image as its words', () => {
		expect(
			renderSanitizedHtml(
				'Created `notes.md` with **one** line, see [the docs](https://example.com) ![the shot](a.png)',
				'inline',
			),
		).toBe(
			'Created <code>notes.md</code> with <strong>one</strong> line, see <a href="https://example.com">the docs</a> the shot',
		);
	});

	it('keeps escaped marks as the characters they are', () => {
		expect(
			renderSanitizedHtml(
				'Started it; it writes \\`notes.md\\` with \\*\\*one\\*\\* line.',
				'inline',
			),
		).toBe('Started it; it writes `notes.md` with **one** line.');
	});
});
