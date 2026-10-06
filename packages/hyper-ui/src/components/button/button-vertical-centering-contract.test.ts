import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const button = readFileSync(new URL('./Button.svelte', import.meta.url), 'utf8');
const buttonsCss = readFileSync(
	new URL('../../styles/components/buttons.css', import.meta.url),
	'utf8',
);

describe('button vertical centering', () => {
	it('carries no block-axis optical nudge', () => {
		for (const source of [button, buttonsCss]) {
			expect(source).not.toMatch(/padding-block-start\s*:/u);
			expect(source).not.toMatch(/padding-top\s*:\s*0?\.\d+em/u);
			expect(source).not.toMatch(/\bpt-\[[^\]]*em\]/u);
		}
	});
});
