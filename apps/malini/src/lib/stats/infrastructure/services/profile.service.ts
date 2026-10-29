import type {
	ProfileState,
	PublicRepository,
	PublishStatsResult,
	StatsPart,
} from '$contract/stats';
import { STATS_PROFILE_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class ProfileService {
	profile(): Promise<ProfileState> {
		return invoke('stats.profile', undefined);
	}

	signIn(): Promise<ProfileState> {
		return invoke('stats.sign-in', undefined);
	}

	cancelSignIn(): Promise<ProfileState> {
		return invoke('stats.cancel-sign-in', undefined);
	}

	publish(handle: string): Promise<PublishStatsResult> {
		return invoke('stats.publish', { handle });
	}

	unpublish(): Promise<ProfileState> {
		return invoke('stats.unpublish', undefined);
	}

	signOut(): Promise<ProfileState> {
		return invoke('stats.sign-out', undefined);
	}

	pickRepositories(repositories: readonly string[]): Promise<ProfileState> {
		return invoke('stats.pick-repositories', { repositories });
	}

	sharePart(part: StatsPart, on: boolean): Promise<ProfileState> {
		return invoke('stats.share-part', { part, on });
	}

	publicRepositories(): Promise<readonly PublicRepository[]> {
		return invoke('stats.public-repositories', undefined);
	}

	onProfileChanged(listener: (state: ProfileState) => void): () => void {
		return onPlatformEvent(STATS_PROFILE_CHANGED_CHANNEL, listener);
	}
}

export const profileService = new ProfileService();
