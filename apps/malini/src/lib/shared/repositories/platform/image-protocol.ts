import { access } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { protocol, type CustomScheme } from 'electron';
import { parseWorkstreamImageUrl, WORKSTREAM_IMAGE_SCHEME } from '$contract/workstream-images';
import { agentHasReadFile, getRunWorkstreamId, shownMediaPaths } from '$lib/chat/chat.platform';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { isInsideDirectory } from '$main/fs/paths';
import type { CheckoutResolver } from './checkout-resolver';
import { parseWorkstreamId, shownFileKey, workstreamFile, workstreamMediaResponse } from './images';
import { keepShownFile, shownFile } from './kept-folders';
import { listStartedWorkstreams } from './workstreams.repository';

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

type ShownMedia = Readonly<{ workstreamId: string; path: string }>;

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
	const owning = (workstreamId: string, path: string): ShownMedia => {
		const started = isAbsolute(path)
			? listStartedWorkstreams(db, workstreamId).find((child) =>
					isInsideDirectory(child.path, path),
				)
			: undefined;
		return started
			? { workstreamId: started.id, path: relative(started.path, path) }
			: { workstreamId, path };
	};

	const keep = async (workstreamId: string, paths: readonly string[]): Promise<void> => {
		for (const shown of paths.map((path) => owning(workstreamId, path))) {
			const worktree = await checkouts.resolveCheckout(shown.workstreamId);
			const file = await liveFile(shown.workstreamId, worktree, shown.path).catch(() => null);
			if (file === null) continue;
			const key = await shownFileKey(worktree, shown.path);
			await keepShownFile(appDataRoot, shown.workstreamId, key, file);
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
		const shown = owning(workstreamId, path);
		const worktree = await checkouts.resolveCheckout(shown.workstreamId);
		const file = await liveFile(shown.workstreamId, worktree, shown.path);
		if (file !== null && (await exists(file))) return file;
		return shownFile(appDataRoot, shown.workstreamId, await shownFileKey(worktree, shown.path));
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
