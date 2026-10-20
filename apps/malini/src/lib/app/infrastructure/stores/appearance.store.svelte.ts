import {
	parseAppearance,
	parseThemeMode,
	resolveTheme,
	type Appearance,
	type Theme,
	type ThemeMode,
} from '$lib/app/domain/appearance';
import { parseLooks, type Look } from '$lib/app/domain/look';

const APPEARANCE_KEY = 'malini.settings.appearance';
const THEME_MODE_KEY = 'malini.settings.theme';
const LOOKS_KEY = 'malini.settings.looks';

class AppearanceStore {
	#appearance: Appearance = $state(parseAppearance(readJson(APPEARANCE_KEY)));
	#themeMode: ThemeMode = $state(parseThemeMode(read(THEME_MODE_KEY)));
	#looks: readonly Look[] = $state.raw(parseLooks(readJson(LOOKS_KEY)));
	#systemPrefersDark: boolean = $state(
		globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
	);

	get appearance(): Appearance {
		return this.#appearance;
	}

	get themeMode(): ThemeMode {
		return this.#themeMode;
	}

	get theme(): Theme {
		return resolveTheme(this.#themeMode, this.#systemPrefersDark);
	}

	get looks(): readonly Look[] {
		return this.#looks;
	}

	tune(appearance: Appearance): void {
		this.#appearance = appearance;
		write(APPEARANCE_KEY, JSON.stringify(appearance));
	}

	keepLooks(looks: readonly Look[]): void {
		if (looks === this.#looks) return;
		this.#looks = looks;
		write(LOOKS_KEY, JSON.stringify(looks));
	}

	chooseThemeMode(mode: ThemeMode): void {
		this.#themeMode = mode;
		write(THEME_MODE_KEY, mode);
	}

	followSystem(prefersDark: boolean): void {
		this.#systemPrefersDark = prefersDark;
	}
}

function read(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function readJson(key: string): unknown {
	const raw = read(key);
	if (raw === null) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {}
}

export const appearanceStore = new AppearanceStore();
