import type {
	BestboyProjects,
	ProfileState,
	PublicRepository,
	PublishStatsResult,
	SetProjectArgs,
} from '$contract/stats';
import { STATS_PROFILE_CHANGED_CHANNEL, STATS_PROJECTS_CHANGED_CHANNEL } from '$contract/events';
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

	publicRepositories(): Promise<readonly PublicRepository[]> {
		return invoke('stats.public-repositories', undefined);
	}

	projects(): Promise<BestboyProjects> {
		return invoke('stats.projects', undefined);
	}

	setProject(project: SetProjectArgs): Promise<BestboyProjects> {
		return invoke('stats.set-project', project);
	}

	onProfileChanged(listener: (state: ProfileState) => void): () => void {
		return onPlatformEvent(STATS_PROFILE_CHANGED_CHANNEL, listener);
	}

	onProjectsChanged(listener: (projects: BestboyProjects) => void): () => void {
		return onPlatformEvent(STATS_PROJECTS_CHANGED_CHANNEL, listener);
	}
}

export const profileService = new ProfileService();
