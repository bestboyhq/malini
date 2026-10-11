import { PULL_REQUESTS_SHIP_CHANGED_CHANNEL } from '$contract/events';
import type { ShipStateRecord } from '$contract/pull-requests';
import type {
	PullRequestShip,
	PullRequestShipChange,
	PullRequestShipIntent,
} from '$lib/pull-requests/domain/pull-request-ship';
import { PullRequestShipMapper } from '$lib/pull-requests/infrastructure/mappers/pull-request-ship.mapper';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class PullRequestShipService {
	async list(): Promise<readonly PullRequestShip[]> {
		return PullRequestShipMapper.fromRawList(await invoke('pull-requests.ship-states', undefined));
	}

	async send(intent: PullRequestShipIntent, workstreamId: string): Promise<PullRequestShip | null> {
		const raw = await this.#invoke(intent, workstreamId);
		return raw === null ? null : PullRequestShipMapper.fromRaw(raw);
	}

	onChanged(listener: (change: PullRequestShipChange) => void): () => void {
		return onPlatformEvent(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, (raw) =>
			listener(PullRequestShipMapper.changeFromRaw(raw)),
		);
	}

	#invoke(intent: PullRequestShipIntent, workstreamId: string): Promise<ShipStateRecord | null> {
		const args = { workstreamId };
		if (intent === 'open-draft') return invoke('pull-requests.open-draft', args);
		if (intent === 'queue-merge') return invoke('pull-requests.queue-merge', args);
		if (intent === 'retry-merge') return invoke('pull-requests.retry-merge', args);
		return invoke('pull-requests.cancel-merge', args);
	}
}

export const pullRequestShipService = new PullRequestShipService();
