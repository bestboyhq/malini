import {
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
} from '$contract/events';
import type { ShipButton, ShipChangedEvent } from '$contract/pull-requests';
import type {
	PullRequestShip,
	PullRequestShipChange,
	PullRequestShipIntent,
} from '$lib/pull-requests/domain/pull-request-ship';
import { PullRequestShipMapper } from '$lib/pull-requests/infrastructure/mappers/pull-request-ship.mapper';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

const BUTTONS: Readonly<Record<PullRequestShipIntent, ShipButton>> = {
	'open-draft': 'draft',
	'queue-merge': 'merge',
	'retry-merge': 'retry',
	'cancel-merge': 'cancel',
};

class PullRequestShipService {
	async list(): Promise<readonly PullRequestShip[]> {
		return PullRequestShipMapper.fromRawList(await invoke('pull-requests.ship-states', undefined));
	}

	async send(intent: PullRequestShipIntent, workstreamId: string): Promise<PullRequestShip | null> {
		const raw = await invoke('pull-requests.button-clicked', {
			workstreamId,
			button: BUTTONS[intent],
		});
		return raw === null ? null : PullRequestShipMapper.fromRaw(raw);
	}

	async reopen(workstreamId: string, pullRequestNumber: number): Promise<void> {
		await invoke('pull-requests.reopen', { workstreamId, pullRequestNumber });
	}

	async opened(workstreamId: string): Promise<void> {
		await invoke('pull-requests.workstream-opened', { workstreamId });
	}

	onChanged(listener: (change: PullRequestShipChange) => void): () => void {
		const changed = (raw: ShipChangedEvent): void =>
			listener(PullRequestShipMapper.changeFromRaw(raw));
		const stops = [
			onPlatformEvent(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, changed),
			onPlatformEvent(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, changed),
		];
		return () => {
			for (const stop of stops) stop();
		};
	}
}

export const pullRequestShipService = new PullRequestShipService();
