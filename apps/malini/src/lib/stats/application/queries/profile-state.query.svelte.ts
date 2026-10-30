import type { ProfileState } from '$contract/stats';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';

export { profileStateQuery };

class ProfileStateQuery {
	public readonly data: ProfileState | null = $derived(profileAggregate.state);
}

const profileStateQuery = new ProfileStateQuery();
