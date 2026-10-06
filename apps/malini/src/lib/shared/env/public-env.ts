type PublicEnvKey = `PUBLIC_${string}`;

type PublicEnvSource = Record<string, string | undefined>;

const runtimePublicEnv: PublicEnvSource = import.meta.env;

export function readPublicEnv(
	key: PublicEnvKey,
	source: PublicEnvSource = runtimePublicEnv,
): string | undefined {
	const suffix = key.slice('PUBLIC_'.length);
	return source[`RENDERER_VITE_${suffix}`] ?? source[`VITE_${suffix}`] ?? source[key];
}

export function publicEnv(key: PublicEnvKey, source: PublicEnvSource = runtimePublicEnv): string {
	const value = readPublicEnv(key, source);

	if (!value) {
		throw new Error(`Missing public environment variable: ${key}`);
	}

	return value;
}

export function optionalPublicEnv(
	key: PublicEnvKey,
	fallback: string,
	source: PublicEnvSource = runtimePublicEnv,
): string {
	const value = readPublicEnv(key, source);

	return value ? value : fallback;
}

export function isDev(): boolean {
	return import.meta.env.DEV;
}
