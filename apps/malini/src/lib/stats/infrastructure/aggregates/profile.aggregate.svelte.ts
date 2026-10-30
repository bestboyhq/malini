import type { ProfileState } from '$contract/stats';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

class ProfileAggregate {
	state = $state.raw<ProfileState | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const state = await profileService.profile();
		if (generation !== this.#generation) return;
		this.state = state;
	}

	replace(state: ProfileState): void {
		this.#generation += 1;
		this.state = state;
	}
}

export const profileAggregate = new ProfileAggregate();
