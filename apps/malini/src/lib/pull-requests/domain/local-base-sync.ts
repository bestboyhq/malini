import type { LocalBaseSyncedPayload } from '$contract/events';

export function localBaseSyncWarning(sync: LocalBaseSyncedPayload): string | null {
	if (sync.outcome === 'advanced') return null;
	if (sync.outcome === 'diverged') {
		return `Local ${sync.branch} has commits GitHub does not, so it was left as is`;
	}
	const reason = sync.detail
		?.split('\n')
		.find((line) => line.trim())
		?.trim();
	return `Local ${sync.branch} was not updated${reason ? `: ${reason}` : ''}`;
}
