import type { WindowControlsTint } from '$contract/commands';
import type { Theme } from '$lib/app/domain/appearance';

const GREYS_STYLE_ID = 'malini-greys';
const GREYS_STYLESHEET_KEY = 'malini.settings.greys-stylesheet';
const PREFERS_DARK = '(prefers-color-scheme: dark)';

class AppearanceDocumentService {
	applyGreys(stylesheet: string): void {
		this.#rememberForBoot(stylesheet);
		const existing = document.getElementById(GREYS_STYLE_ID);
		if (!stylesheet) {
			existing?.remove();
			return;
		}
		const style = existing instanceof HTMLStyleElement ? existing : this.#createStyle();
		style.textContent = stylesheet;
	}

	applyTheme(theme: Theme): void {
		document.documentElement.setAttribute('data-theme', theme);
	}

	windowControlsTint(): WindowControlsTint {
		const style = getComputedStyle(document.documentElement);
		return {
			background: srgbHex(style.getPropertyValue('--color-surface-root')),
			symbol: srgbHex(style.getPropertyValue('--color-fg-secondary')),
		};
	}

	watchSystemTheme(onchange: (prefersDark: boolean) => void): () => void {
		const media = globalThis.matchMedia?.(PREFERS_DARK);
		if (!media) return () => undefined;
		const listener = (event: MediaQueryListEvent): void => onchange(event.matches);
		media.addEventListener('change', listener);
		onchange(media.matches);
		return () => media.removeEventListener('change', listener);
	}

	#createStyle(): HTMLStyleElement {
		const style = document.createElement('style');
		style.id = GREYS_STYLE_ID;
		document.head.append(style);
		return style;
	}

	#rememberForBoot(stylesheet: string): void {
		try {
			if (stylesheet) globalThis.localStorage?.setItem(GREYS_STYLESHEET_KEY, stylesheet);
			else globalThis.localStorage?.removeItem(GREYS_STYLESHEET_KEY);
		} catch {}
	}
}

function srgbHex(color: string): string {
	const canvas = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
	if (!canvas) throw new Error('the window controls cannot read the theme colors');
	canvas.fillStyle = color;
	canvas.fillRect(0, 0, 1, 1);
	const [red = 0, green = 0, blue = 0] = canvas.getImageData(0, 0, 1, 1).data;
	return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const appearanceDocumentService = new AppearanceDocumentService();
