import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const iconButton = readFileSync(new URL('./IconButton.svelte', import.meta.url), 'utf8');

describe('Button contract', () => {
	it('provides a required accessible name for the dedicated icon primitive', () => {
		expect(iconButton).toContain('ariaLabel: string;');
		expect(iconButton).toMatch(
			/<Button\s+\{\.\.\.buttonProps\}[\s\S]*\{ariaLabel\}[\s\S]*iconOnly>/u,
		);
	});
});
