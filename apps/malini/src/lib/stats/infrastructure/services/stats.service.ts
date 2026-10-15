import type { ActivityStats, ResourceHistory, ResourceSample } from '$contract/stats';
import { STATS_RESOURCES_SAMPLED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class StatsService {
	activity(): Promise<ActivityStats> {
		return invoke('stats.activity', undefined);
	}

	resources(): Promise<ResourceHistory> {
		return invoke('stats.resources', undefined);
	}

	onResourcesSampled(listener: (sample: ResourceSample) => void): () => void {
		return onPlatformEvent(STATS_RESOURCES_SAMPLED_CHANNEL, listener);
	}
}

export const statsService = new StatsService();
