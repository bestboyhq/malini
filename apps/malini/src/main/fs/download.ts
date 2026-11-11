import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { InstallProgressPayload } from '$contract/events';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type SaveDownloadOptions = Readonly<{
	onProgress: (progress: InstallProgressPayload) => void;
	total?: number | null;
	stallMs?: number;
}>;

export const DOWNLOAD_STALL_MS = 30_000;
const PROGRESS_STEPS = 100;
const UNKNOWN_SIZE_STEP = 1_000_000;

export async function saveDownload(
	fetch: Fetch,
	url: string,
	file: string,
	{ onProgress, total = null, stallMs = DOWNLOAD_STALL_MS }: SaveDownloadOptions,
): Promise<string> {
	const controller = new AbortController();
	const stalled = new Promise<never>((_resolve, reject) => {
		controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
			once: true,
		});
	});
	stalled.catch(() => {});
	let stall: ReturnType<typeof setTimeout> | undefined;
	const expectData = (): void => {
		clearTimeout(stall);
		stall = setTimeout(
			() => controller.abort(new Error(`no data for ${Math.round(stallMs / 1000)} seconds`)),
			stallMs,
		);
	};
	expectData();
	const handle = await open(file, 'w');
	try {
		const response = await Promise.race([fetch(url, { signal: controller.signal }), stalled]);
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		const reader = response.body.getReader();
		controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), {
			once: true,
		});
		const size = total ?? contentLength(response);
		const step = size ? Math.max(1, Math.ceil(size / PROGRESS_STEPS)) : UNKNOWN_SIZE_STEP;
		const hash = createHash('sha256');
		let received = 0;
		let reported = 0;
		onProgress({ received, total: size });
		for (;;) {
			const chunk = await Promise.race([reader.read(), stalled]);
			if (chunk.done) break;
			expectData();
			hash.update(chunk.value);
			await handle.write(chunk.value);
			received += chunk.value.byteLength;
			if (received - reported >= step) {
				reported = received;
				onProgress({ received, total: size });
			}
		}
		onProgress({ received, total: size });
		return hash.digest('hex');
	} catch (error) {
		throw controller.signal.aborted ? controller.signal.reason : error;
	} finally {
		clearTimeout(stall);
		await handle.close();
	}
}

function contentLength(response: Response): number | null {
	const length = Number(response.headers.get('content-length'));
	return Number.isSafeInteger(length) && length > 0 ? length : null;
}
