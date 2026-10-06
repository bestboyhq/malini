import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skeleton = readFileSync(new URL('./Skeleton.svelte', import.meta.url), 'utf8');

describe('shared loading motion contract', () => {
	it('disables skeleton motion when reduced motion is requested', () => {
		const reducedMotion = skeleton.slice(
			skeleton.indexOf('@media (prefers-reduced-motion: reduce)'),
			skeleton.indexOf('</style>'),
		);
		expect(reducedMotion).toContain('animation: none');
		expect(reducedMotion).toContain('opacity: 0');
		expect(reducedMotion).toContain('will-change: auto');
	});
});

const keyframes = readFileSync(
	new URL('../../styles/tokens/keyframes.css', import.meta.url),
	'utf8',
);

describe('shared keyframes', () => {
	it('declares each animation once', () => {
		const names = [...keyframes.matchAll(/@keyframes\s+([\w-]+)/gu)].map((match) => match[1]);
		const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
		expect(duplicated).toEqual([]);
	});

	it('spins continuously, with no frame that holds still', () => {
		const spin = keyframes.slice(keyframes.indexOf('@keyframes spin'));
		const body = spin.slice(
			0,
			spin.indexOf('@keyframes', 1) === -1 ? undefined : spin.indexOf('@keyframes', 1),
		);
		expect(body).toMatch(/to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}/u);
		expect(body).not.toMatch(/\d+%\s*\{/u);
	});
});
