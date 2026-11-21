import {
	REPOSITORIES_CLONE_PROGRESS_CHANNEL,
	REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL,
	type CloneProgressPayload,
} from '$contract/events';
import type { CheckoutHealth, WorkstreamCheckoutHealthPayload } from '$contract/repositories';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class CheckoutHealthService {
	read(workstreamId: string): Promise<CheckoutHealth> {
		return invoke('repositories.checkout-health', { workstreamId });
	}

	repair(workstreamId: string): Promise<CheckoutHealth> {
		return invoke('repositories.repair-checkout', { workstreamId });
	}

	onCloneProgress(listener: (repoId: string, fraction: number) => void): () => void {
		return onPlatformEvent(
			REPOSITORIES_CLONE_PROGRESS_CHANNEL,
			(payload: CloneProgressPayload | null) => {
				if (typeof payload?.repo_id !== 'string' || typeof payload.fraction !== 'number') return;
				listener(payload.repo_id, payload.fraction);
			},
		);
	}

	onChanged(listener: (payload: WorkstreamCheckoutHealthPayload) => void): () => void {
		return onPlatformEvent(REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL, listener);
	}
}

export const checkoutHealthService = new CheckoutHealthService();
