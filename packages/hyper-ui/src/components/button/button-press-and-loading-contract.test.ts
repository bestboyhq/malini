import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const button = readFileSync(new URL('./Button.svelte', import.meta.url), 'utf8');
const buttonsCss = readFileSync(
	new URL('../../styles/components/buttons.css', import.meta.url),
	'utf8',
);
const darkTheme = readFileSync(new URL('../../styles/themes/dark.css', import.meta.url), 'utf8');
const lightTheme = readFileSync(new URL('../../styles/themes/light.css', import.meta.url), 'utf8');
const aliases = readFileSync(
	new URL('../../styles/tokens/colors-aliases.css', import.meta.url),
	'utf8',
);

const PRESS_SCALE = '0.975';

describe('button press feedback', () => {
	it('presses to the design system scale, in the component and in the class-based shapes', () => {
		expect(button).toContain(`active:scale-[${PRESS_SCALE}]`);
		expect(buttonsCss).toContain(`scale: ${PRESS_SCALE}`);
	});

	it('transitions `scale`, which is the property the utility actually sets', () => {
		expect(button).toMatch(/transition-\[[^\]]*\bscale\b[^\]]*\]/u);
		expect(buttonsCss).toMatch(/transition-property:[^;]*\bscale\b/u);
	});

	it('holds still under reduced motion', () => {
		expect(button).toContain('motion-reduce:active:scale-100');
		const reduced = buttonsCss.slice(buttonsCss.indexOf('@media (prefers-reduced-motion: reduce)'));
		expect(reduced).toContain('scale: 1;');
	});

	it('withholds the press from a control that cannot take the click', () => {
		expect(buttonsCss).toContain('.btn:not(:disabled):active');
		expect(button).toContain('inert ? undefined : [interactionClass[variant], pressClass]');
	});

	it('emits no skin at all in `bare` mode, the press included', () => {
		expect(button).toMatch(/bare\s*\n?\s*\?\s*undefined/u);
	});
});

describe('button loading state', () => {
	it('keeps the label, adds a spinner, and stops accepting input', () => {
		expect(button).toContain('loading?: boolean;');
		expect(button).toContain('const inert = $derived(disabled || loading)');
		expect(button).toContain('aria-busy={busy}');
		expect(button).toContain('<LoadingCircle size={spinnerSize[size]} />');
	});

	it('sizes the spinner off the label rather than at one fixed figure', () => {
		expect(button).toContain('const spinnerSize: Record<ButtonSize, number>');
	});

	it('marks the running control for anything reading the DOM', () => {
		expect(button.match(/data-loading=\{loading \? 'true' : undefined\}/gu)).toHaveLength(2);
	});
});

describe('a control that cannot take a click', () => {
	it('says so with a surface, not by fading', () => {
		expect(button).not.toContain("'opacity-40':");
		expect(button).not.toContain("'disabled:opacity-40'");
		expect(buttonsCss).not.toMatch(/@apply[^;]*opacity-40/u);
		expect(button).toContain('bg-button-disabled text-button-disabled-content');
		expect(buttonsCss).toContain('bg-button-disabled text-button-disabled-content');
	});

	it('separates working from unavailable', () => {
		expect(button).toContain('bg-button-primary-busy text-button-primary-busy-content');
		expect(button).toContain('const busyClass');
		expect(button).toContain('const disabledClass');
	});

	it('emits exactly one surface, because Tailwind sorts utilities by its own order', () => {
		expect(button).toContain('const surfaceClass = $derived(');
		expect(button).toContain('? disabledClass[variant]');
		expect(button).toContain('? busyClass[variant]');
		expect(button).toContain(': variantClass[variant],');
		expect(button).not.toMatch(/variantClass\[variant\],\n\s*focusClass\[variant\]/u);
	});

	it('keeps the variant fill for a control that is inert because it is already so', () => {
		expect(button).toContain('disabled && dims');
	});

	it('binds both surfaces in both themes', () => {
		for (const token of [
			'--themed-color-button-disabled',
			'--themed-color-button-disabled-content',
			'--themed-color-button-primary-busy',
			'--themed-color-button-primary-busy-content',
			'--themed-color-button-secondary-busy',
		]) {
			expect(darkTheme).toContain(`${token}:`);
			expect(lightTheme).toContain(`${token}:`);
			expect(aliases).toContain(`var(${token})`);
		}
	});
});
