import { access } from 'node:fs/promises';
import { protocol, type CustomScheme } from 'electron';
import { parseWorkstreamImageUrl, WORKSTREAM_IMAGE_SCHEME } from '$contract/workstream-images';
import { agentHasReadFile, getRunWorkstreamId, shownMediaPaths } from '$lib/chat/chat.platform';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import type { CheckoutResolver } from './checkout-resolver';
import { parseWorkstreamId, shownFileKey, workstreamFile, workstreamMediaResponse } from './images';
import { keepShownFile, shownFile } from './kept-folders';

export const WORKSTREAM_IMAGE_SCHEME_PRIVILEGES: CustomScheme = {
	scheme: WORKSTREAM_IMAGE_SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		stream: true,
		corsEnabled: true,
	},
};

export type WorkstreamFileResolver = (workstreamId: string, path: string) => Promise<string | null>;

export function workstreamMedia(
	{ db, events, appDataRoot }: Pick<MainContext, 'db' | 'events' | 'appDataRoot'>,
	checkouts: Pick<CheckoutResolver, 'resolveCheckout'>,
): WorkstreamFileResolver {
	// ponytail: remembers every confirmed agent read for the app's lifetime, even after its chat is forgotten; key it by session if that matters
	const agentReads = new Set<string>();
	const agentHasRead = (workstreamId: string, file: string): boolean => {
		const key = `${workstreamId}\u0000${file}`;
		if (agentReads.has(key)) return true;
		const read = agentHasReadFile(db, workstreamId, file);
		if (read) agentReads.add(key);
		return read;
	};
	const liveFile = (workstreamId: string, worktree: string, path: string) =>
		workstreamFile(worktree, path, (file) => agentHasRead(workstreamId, file));

	const keep = async (workstreamId: string, paths: readonly string[]): Promise<void> => {
		const worktree = await checkouts.resolveCheckout(workstreamId);
		for (const path of paths) {
			const file = await liveFile(workstreamId, worktree, path).catch(() => null);
			if (file === null) continue;
			await keepShownFile(appDataRoot, workstreamId, await shownFileKey(worktree, path), file);
		}
	};
	events.subscribe('chat:agent-event', ({ ephemeral, runId, event }) => {
		const paths = ephemeral ? [] : shownMediaPaths(event);
		const workstreamId = paths.length > 0 ? getRunWorkstreamId(db, runId) : null;
		if (workstreamId === null) return;
		void keep(workstreamId, paths).catch((error: unknown) =>
			console.error(
				`malini: could not keep a copy of what a chat in workstream \`${workstreamId}\` showed: ${describeError(error)}`,
			),
		);
	});

	return async (workstreamId, path) => {
		const worktree = await checkouts.resolveCheckout(workstreamId);
		const file = await liveFile(workstreamId, worktree, path);
		if (file !== null && (await exists(file))) return file;
		return shownFile(appDataRoot, workstreamId, await shownFileKey(worktree, path));
	};
}

async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

export function serveWorkstreamImages(resolve: WorkstreamFileResolver): void {
	protocol.handle(WORKSTREAM_IMAGE_SCHEME, (request) =>
		workstreamImageResponse(request.url, request.headers.get('range'), resolve),
	);
}

export async function workstreamImageResponse(
	url: string,
	range: string | null,
	resolve: WorkstreamFileResolver,
): Promise<Response> {
	const target = parseWorkstreamImageUrl(url);
	if (!target) return new Response('Not a workstream image', { status: 400 });
	try {
		const file = await resolve(parseWorkstreamId(target.workstreamId), target.path);
		if (file === null) return new Response('missing', { status: 404 });
		return await workstreamMediaResponse(file, range);
	} catch {
		return new Response('Unreadable workstream image', { status: 403 });
	}
}
