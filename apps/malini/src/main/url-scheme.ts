export const URL_SCHEME = 'malini';

export function claimsUrlScheme(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): boolean {
	return !packaged && env['MALINI_DOGFOOD'] === '1' && env['MALINI_BACKGROUND_WINDOW'] !== '1';
}

export interface UrlInbox {
	receive(url: string): void;
	deliverTo(open: (url: string) => void): void;
}

export function urlInbox(): UrlInbox {
	const waiting: string[] = [];
	let open: ((url: string) => void) | null = null;
	return {
		receive(url) {
			if (open) open(url);
			else waiting.push(url);
		},
		deliverTo(next) {
			open = next;
			for (const url of waiting.splice(0)) next(url);
		},
	};
}
