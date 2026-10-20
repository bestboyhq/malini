import type {
	ActivityStats,
	ResourceHistory,
	ResourceKindBreakdown,
	ResourceSample,
	StopRunningArgs,
	WorkstreamRunning,
} from '$contract/stats';
import {
	STATS_RESOURCES_SAMPLED_CHANNEL,
	STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class StatsService {
	activity(): Promise<ActivityStats> {
		return invoke('stats.activity', undefined);
	}

	resources(): Promise<ResourceHistory> {
		return invoke('stats.resources', undefined);
	}

	resourceBreakdown(): Promise<readonly ResourceKindBreakdown[]> {
		return invoke('stats.resource-breakdown', undefined);
	}

	onResourcesSampled(listener: (sample: ResourceSample) => void): () => void {
		return onPlatformEvent(STATS_RESOURCES_SAMPLED_CHANNEL, listener);
	}

	workstreamRunning(): Promise<readonly WorkstreamRunning[]> {
		return invoke('stats.workstream-running', undefined);
	}

	stopRunning(args: StopRunningArgs): Promise<void> {
		return invoke('stats.stop-running', args);
	}

	onWorkstreamRunningChanged(
		listener: (running: readonly WorkstreamRunning[]) => void,
	): () => void {
		return onPlatformEvent(STATS_WORKSTREAM_RUNNING_CHANGED_CHANNEL, listener);
	}
}

export const statsService = new StatsService();
