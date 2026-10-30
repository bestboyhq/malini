export const URL_SCHEME = 'malini';

export function claimsUrlScheme(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): boolean {
	return !packaged && env['MALINI_DOGFOOD'] === '1' && env['MALINI_BACKGROUND_WINDOW'] !== '1';
}
