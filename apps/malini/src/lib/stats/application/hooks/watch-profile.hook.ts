import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export function watchProfileHook(): () => void {
	return profileService.onProfileChanged((state) => profileAggregate.replace(state));
}
