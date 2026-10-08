import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fullPageModal = readFileSync(new URL('./FullPageModal.svelte', import.meta.url), 'utf8');

describe('full page modal dismissal comes from the scrim, not the content', () => {
	function markup(): string {
		return fullPageModal.slice(fullPageModal.indexOf('{#if open}'));
	}

	it('does not close on a click inside the content', () => {
		const contentWrapper =
			markup().match(/<div\s+class=\{\[\s*'styled-scrollbar[\s\S]*?>/u)?.[0] ?? '';
		expect(contentWrapper).not.toBe('');
		expect(contentWrapper).not.toContain('onclick');
	});

	it('lets a click on empty content land on the scrim by keeping the content pointer-transparent', () => {
		const contentWrapper =
			markup().match(/<div\s+class=\{\[\s*'styled-scrollbar[\s\S]*?>/u)?.[0] ?? '';
		expect(contentWrapper).not.toContain('pointer-events-auto');
	});

	it('closes on a click on the scrim', () => {
		const backdrop = markup().match(/<div\s+class="animate-fadeIn absolute[\s\S]*?><\/div>/u)?.[0];
		expect(backdrop).toContain('onclick={startClose}');
	});

	it('lets a click land on the scrim by keeping the dialog frame pointer-transparent', () => {
		const dialog = markup().match(/<div[^>]*role="dialog"[\s\S]*?>/u)?.[0] ?? '';
		expect(dialog).toContain('pointer-events-none');
	});
});
