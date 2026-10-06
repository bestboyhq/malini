import type { LocalBaseSyncedPayload } from '$contract/events';

export type LocalBaseSyncNotice = Readonly<{
	level: 'success' | 'warning';
	message: string;
}>;

export function localBaseSyncNotice(sync: LocalBaseSyncedPayload): LocalBaseSyncNotice {
	if (sync.outcome === 'advanced') {
		return { level: 'success', message: `Local ${sync.branch} now includes the merge` };
	}
	if (sync.outcome === 'diverged') {
		return {
			level: 'warning',
			message: `Local ${sync.branch} has commits GitHub does not, so it was left as is`,
		};
	}
	const reason = sync.detail
		?.split('\n')
		.find((line) => line.trim())
		?.trim();
	return {
		level: 'warning',
		message: `Local ${sync.branch} was not updated${reason ? `: ${reason}` : ''}`,
	};
}
