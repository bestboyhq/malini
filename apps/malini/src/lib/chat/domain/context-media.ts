import { BRIDGE_AGENT_CONTEXT_PATH } from '$contract/protocol-contract.generated';
import {
	CONTEXT_MEDIA_CATEGORIES,
	type ContextMedia,
	type ContextMediaCategory,
} from '$contract/workstream-images';
import { agoLabel } from '$lib/brain/domain/brain';

export type ContextMediaListing =
	| Readonly<{ workstreamId: string; status: 'loading' }>
	| Readonly<{ workstreamId: string; status: 'ready'; media: readonly ContextMedia[] }>
	| Readonly<{ workstreamId: string; status: 'failed'; error: string }>;

export type ContextMediaTab = Readonly<{ category: ContextMediaCategory | 'all'; count: number }>;

export function touchesContextMedia(changedPaths: readonly string[] | null): boolean {
	return (
		changedPaths === null ||
		changedPaths.some(
			(path) =>
				path === BRIDGE_AGENT_CONTEXT_PATH || path.startsWith(`${BRIDGE_AGENT_CONTEXT_PATH}/`),
		)
	);
}

export function contextMediaTabs(media: readonly ContextMedia[]): ContextMediaTab[] {
	const tabs = CONTEXT_MEDIA_CATEGORIES.map((category) => ({
		category,
		count: media.filter((item) => item.category === category).length,
	})).filter(({ count }) => count > 0);
	return [{ category: 'all', count: media.length }, ...tabs];
}

export function contextMediaAge(modifiedAt: string, now: number): string {
	return agoLabel(modifiedAt, now);
}
