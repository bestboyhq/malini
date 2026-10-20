import { describe, expect, it } from 'vitest';
import { compileGlyph, compileGlyphs } from './icons.mjs';

const frame =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';

/**
 * @param {string} shapes
 * @param {string} [root]
 */
const glyph = (shapes, root = frame) => `${root}\n\t${shapes}\n</svg>\n`;

describe('compileGlyph', () => {
	it('turns every shape into path data and keeps filled shapes apart', () => {
		const compiled = compileGlyph(
			'record',
			glyph(
				'<circle cx="8" cy="8" r="5.75" />\n\t<rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" />\n\t<path d="m4.25 11.75 7.5-7.5" />',
			),
		);

		expect(compiled.outline).toBe(
			'M2.25 8a5.75 5.75 0 1 0 11.5 0a5.75 5.75 0 1 0 -11.5 0ZM4.25 11.75l7.5-7.5',
		);
		expect(compiled.solid).toBe(
			'M7 6h2a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1Z',
		);
	});

	it('keeps the pairs after a leading relative move relative once shapes are joined', () => {
		const compiled = compileGlyph(
			'cross',
			glyph('<path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5" />\n\t<path d="m3 8h10" />'),
		);

		expect(compiled.outline).toBe('M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5M3 8h10');
	});

	it('rejects a glyph whose frame drifts from the pack', () => {
		expect(() =>
			compileGlyph('heavy', glyph('<path d="M4 8h8" />', frame.replace('1.5', '2'))),
		).toThrow('<svg> needs stroke-width="1.5"');
	});

	it('rejects styling, groups and transforms on shapes', () => {
		expect(() => compileGlyph('red', glyph('<path d="M4 8h8" stroke="red" />'))).toThrow(
			'cannot carry stroke',
		);
		expect(() => compileGlyph('grouped', glyph('<g><path d="M4 8h8" /></g>'))).toThrow(
			'<g> is not allowed',
		);
	});

	it('rejects drawings that leave the live area, relative segments included', () => {
		expect(() => compileGlyph('wide', glyph('<path d="M4 8h8l3 0" />'))).toThrow(
			'reaches 15,8, outside the 1.75 to 14.25 live area',
		);
		expect(() => compileGlyph('large', glyph('<circle cx="12" cy="12" r="10" />'))).toThrow(
			'outside the 1.75 to 14.25 live area',
		);
	});

	it('rejects coordinates finer than two decimals', () => {
		expect(() => compileGlyph('fine', glyph('<path d="M4.125 8h8" />'))).toThrow(
			'round to at most 2 decimals',
		);
	});
});

describe('compileGlyphs', () => {
	it('rejects two files that draw the same glyph', () => {
		const line = glyph('<path d="M4 8h8" />');

		expect(() => compileGlyphs({ minus: line, dash: line })).toThrow(
			'minus.svg: draws the same glyph as dash.svg',
		);
	});
});
