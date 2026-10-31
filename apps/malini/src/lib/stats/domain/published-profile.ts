import type { ProfileState } from '$contract/stats';

export function publishedProfileUrl(state: ProfileState | null): string | null {
	return state?.publishing === 'on' ? (state.profile?.url ?? null) : null;
}
