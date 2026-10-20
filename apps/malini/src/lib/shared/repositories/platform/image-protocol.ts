import { protocol, type CustomScheme } from 'electron';
import type { WorkstreamImageRead } from '$contract/repositories';
import { parseWorkstreamImageUrl, WORKSTREAM_IMAGE_SCHEME } from '$contract/workstream-images';
import { agentHasReadFile } from '$lib/chat/chat.platform';
import type { MaliniDatabase } from '$main/db/driver';
import { parseWorkstreamId, readWorkstreamImage } from './images';

export const WORKSTREAM_IMAGE_SCHEME_PRIVILEGES: CustomScheme = {
	scheme: WORKSTREAM_IMAGE_SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true },
};

export type WorkstreamImageReader = (
	workstreamId: string,
	path: string,
) => Promise<WorkstreamImageRead>;

export function serveWorkstreamImages(
	db: MaliniDatabase,
	checkouts: Readonly<{ resolveCheckout(workstreamId: string): Promise<string> }>,
): void {
	const read: WorkstreamImageReader = async (workstreamId, path) =>
		readWorkstreamImage(await checkouts.resolveCheckout(workstreamId), path, (file) =>
			agentHasReadFile(db, workstreamId, file),
		);
	protocol.handle(WORKSTREAM_IMAGE_SCHEME, (request) => workstreamImageResponse(request.url, read));
}

export async function workstreamImageResponse(
	url: string,
	read: WorkstreamImageReader,
): Promise<Response> {
	const target = parseWorkstreamImageUrl(url);
	if (!target) return new Response('Not a workstream image', { status: 400 });
	try {
		const image = await read(parseWorkstreamId(target.workstreamId), target.path);
		if (image.status !== 'ready') return new Response(image.status, { status: 404 });
		return new Response(image.bytes.data, {
			headers: { 'content-type': image.bytes.mediaType, 'x-content-type-options': 'nosniff' },
		});
	} catch {
		return new Response('Unreadable workstream image', { status: 403 });
	}
}
