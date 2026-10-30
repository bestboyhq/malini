import type { ProfileState } from '$contract/stats';

const PUBLISH_HOUR_UTC = 3;

const dayFormat = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC',
});

const hourFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function publishTime(today: Date): string {
	return hourFormat.format(
		new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), PUBLISH_HOUR_UTC),
		),
	);
}

export function uploadLine(state: ProfileState): string | null {
	const { upload, publishing } = state;
	if (publishing === 'removing') {
		if (state.signInNeeded) return 'Sign in to Bestboy again so Malini can remove your stats.';
		if (upload.state === 'failed') {
			return `Malini could not remove your stats yet: ${sentence(upload.reason)} It keeps trying.`;
		}
		return 'Removing your stats from bestboy.dev…';
	}
	if (publishing !== 'on') return null;
	if (state.signInNeeded)
		return 'Bestboy signed you out. Sign in again to keep your profile current.';
	if (upload.state === 'sending') return 'Sending your stats…';
	if (upload.state === 'no-full-day') {
		return 'Your stats go up after your first full day with Malini.';
	}
	if (upload.state === 'published') {
		return `Published through ${dayFormat.format(new Date(`${upload.through}T00:00:00Z`))}.`;
	}
	if (upload.state === 'failed') {
		return upload.retrying
			? `Malini could not send your stats: ${sentence(upload.reason)} It tries again soon.`
			: `Bestboy did not take your stats: ${sentence(upload.reason)}`;
	}
	return null;
}

function sentence(text: string): string {
	return /[.!?]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}
