import type { MessageBoxOptions } from 'electron';
import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';

export type MediaKind = 'audio' | 'video';

export interface MediaPermissions {
	request(url: string, kinds: readonly MediaKind[]): Promise<boolean>;
	allowed(url: string, kind: string | undefined): boolean;
}

const DEVICES = [
	['video', 'camera'],
	['audio', 'microphone'],
] as const;

export function mediaPermissionQuestion(
	origin: string,
	kinds: readonly MediaKind[],
): MessageBoxOptions {
	const { protocol, host } = new URL(origin);
	const site = protocol === `${BROWSER_WORKTREE_SCHEME}:` ? 'this worktree page' : host;
	const devices = DEVICES.filter(([kind]) => kinds.includes(kind)).map(([, device]) => device);
	return {
		type: 'question',
		message: `Allow ${site} to use your ${devices.join(' and ')}?`,
		detail: 'Malini remembers your answer until it quits.',
		buttons: ['Allow', 'Don’t Allow'],
		defaultId: 1,
		cancelId: 1,
	};
}

export function rememberMediaAnswers(
	ask: (question: MessageBoxOptions) => Promise<boolean>,
): MediaPermissions {
	const answers = new Map<string, boolean>();
	let asking = Promise.resolve(false);
	const answer = async (
		turn: Promise<boolean>,
		origin: string,
		kinds: readonly MediaKind[],
	): Promise<boolean> => {
		await turn;
		const unasked = kinds.filter((kind) => !answers.has(`${origin} ${kind}`));
		if (unasked.length > 0) {
			const allowed = await ask(mediaPermissionQuestion(origin, unasked));
			for (const kind of unasked) answers.set(`${origin} ${kind}`, allowed);
		}
		return kinds.every((kind) => answers.get(`${origin} ${kind}`) === true);
	};
	return {
		request: (url, kinds) => {
			const origin = siteOrigin(url);
			if (origin === null || kinds.length === 0) return Promise.resolve(false);
			asking = answer(asking, origin, kinds).catch(() => false);
			return asking;
		},
		allowed: (url, kind) => answers.get(`${siteOrigin(url)} ${kind}`) === true,
	};
}

function siteOrigin(url: string): string | null {
	const parsed = URL.parse(url);
	return parsed?.host ? `${parsed.protocol}//${parsed.host}` : null;
}
