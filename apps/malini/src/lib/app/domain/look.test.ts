import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from './appearance';
import { MAX_LOOKS, parseLooks, rememberedLooks, type Look } from './look';

const stone = DEFAULT_APPEARANCE;
const slate = { ...DEFAULT_APPEARANCE, hue: 250, chroma: 0.013 };
const dim = { ...DEFAULT_APPEARANCE, brightness: -0.4 };

describe('looks history', () => {
	it('puts a new look first', () => {
		const looks = rememberedLooks([{ appearance: stone, savedAt: 1 }], slate, 2);
		expect(looks).toEqual([
			{ appearance: slate, savedAt: 2 },
			{ appearance: stone, savedAt: 1 },
		]);
	});

	it('keeps the history as it is when the look has not changed', () => {
		const looks: readonly Look[] = [{ appearance: slate, savedAt: 1 }];
		expect(rememberedLooks(looks, slate, 2)).toBe(looks);
	});

	it('moves a look worn again to the front instead of listing it twice', () => {
		const looks = rememberedLooks(
			[
				{ appearance: slate, savedAt: 2 },
				{ appearance: stone, savedAt: 1 },
			],
			stone,
			3,
		);
		expect(looks).toEqual([
			{ appearance: stone, savedAt: 3 },
			{ appearance: slate, savedAt: 2 },
		]);
	});

	it(`keeps only the last ${MAX_LOOKS} looks`, () => {
		let looks: readonly Look[] = [];
		for (let index = 0; index <= MAX_LOOKS; index += 1) {
			looks = rememberedLooks(looks, { ...dim, hue: index }, index);
		}
		expect(looks).toHaveLength(MAX_LOOKS);
		expect(looks[0]?.appearance.hue).toBe(MAX_LOOKS);
		expect(looks.at(-1)?.appearance.hue).toBe(1);
	});

	it('drops stored entries that are not looks', () => {
		expect(parseLooks(null)).toEqual([]);
		expect(parseLooks({ savedAt: 1 })).toEqual([]);
		expect(
			parseLooks([{ appearance: dim, savedAt: 5 }, { appearance: dim }, 'slate', null]),
		).toEqual([{ appearance: dim, savedAt: 5 }]);
	});
});
