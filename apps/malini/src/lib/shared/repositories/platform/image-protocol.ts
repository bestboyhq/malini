import { protocol, type CustomScheme } from 'electron';
import { parseWorkstreamImageUrl, WORKSTREAM_IMAGE_SCHEME } from '$contract/workstream-images';
import { agentHasReadFile } from '$lib/chat/chat.platform';
import type { MaliniDatabase } from '$main/db/driver';
import { parseWorkstreamId, workstreamFile, workstreamMediaResponse } from './images';

export const WORKSTREAM_IMAGE_SCHEME_PRIVILEGES: CustomScheme = {
	scheme: WORKSTREAM_IMAGE_SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
};

export type WorkstreamFileResolver = (workstreamId: string, path: string) => Promise<string | null>;

export function serveWorkstreamImages(
	db: MaliniDatabase,
	checkouts: Readonly<{ resolveCheckout(workstreamId: string): Promise<string> }>,
): void {
	// ponytail: remembers every confirmed agent read for the app's lifetime, even after its chat is forgotten; key it by session if that matters
	const agentReads = new Set<string>();
	const agentHasRead = (workstreamId: string, file: string): boolean => {
		const key = `${workstreamId}\u0000${file}`;
		if (agentReads.has(key)) return true;
		const read = agentHasReadFile(db, workstreamId, file);
		if (read) agentReads.add(key);
		return read;
	};
	const resolve: WorkstreamFileResolver = async (workstreamId, path) =>
		workstreamFile(await checkouts.resolveCheckout(workstreamId), path, (file) =>
			agentHasRead(workstreamId, file),
		);
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
