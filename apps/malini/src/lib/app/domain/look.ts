import { parseAppearance, sameAppearance, type Appearance } from './appearance';

export type Look = Readonly<{ appearance: Appearance; savedAt: number }>;

export const MAX_LOOKS = 10;

export function rememberedLooks(
	looks: readonly Look[],
	appearance: Appearance,
	savedAt: number,
): readonly Look[] {
	const latest = looks[0];
	if (latest && sameAppearance(latest.appearance, appearance)) return looks;
	const older = looks.filter((look) => !sameAppearance(look.appearance, appearance));
	return [{ appearance, savedAt }, ...older].slice(0, MAX_LOOKS);
}

export function parseLooks(raw: unknown): readonly Look[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry: unknown): Look[] => {
		if (typeof entry !== 'object' || entry === null) return [];
		const savedAt: unknown = Reflect.get(entry, 'savedAt');
		const appearance: unknown = Reflect.get(entry, 'appearance');
		if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return [];
		if (typeof appearance !== 'object' || appearance === null) return [];
		return [{ appearance: parseAppearance(appearance), savedAt }];
	});
}
