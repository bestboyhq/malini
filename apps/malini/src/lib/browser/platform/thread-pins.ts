import { MALINI_WORLD_ID, type PageContents } from './page';
import { pinsScript, type PagePin, type PinsCommand, type PinStatus } from './thread-pins-page';

export type { PagePin, PinStatus };

export type PinAction = Readonly<{ kind: 'open' | 'dismiss'; sessionId: string }>;

export type ThreadPin = PagePin & Readonly<{ url: string }>;

export interface PinsPage {
	run(command: PinsCommand): Promise<unknown>;
}

export function pinsPage(contents: PageContents): PinsPage {
	return {
		run: (command) =>
			contents.executeJavaScriptInIsolatedWorld(MALINI_WORLD_ID, [{ code: pinsScript(command) }]),
	};
}

export function pinsOnPage(pins: readonly ThreadPin[], url: string): PagePin[] {
	const page = withoutHash(url);
	return pins
		.filter((pin) => withoutHash(pin.url) === page)
		.map(({ sessionId, domPath, prompt, status, outcome }) => ({
			sessionId,
			domPath,
			prompt,
			status,
			outcome,
		}));
}

export function readPinAction(value: unknown): PinAction | null {
	if (typeof value !== 'object' || value === null) return null;
	const kind = Reflect.get(value, 'kind');
	const sessionId = Reflect.get(value, 'sessionId');
	if ((kind !== 'open' && kind !== 'dismiss') || typeof sessionId !== 'string') return null;
	return { kind, sessionId };
}

function withoutHash(url: string): string {
	const hash = url.indexOf('#');
	return hash === -1 ? url : url.slice(0, hash);
}
