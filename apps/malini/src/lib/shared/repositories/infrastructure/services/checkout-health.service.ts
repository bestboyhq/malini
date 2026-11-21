import { REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL } from '$contract/events';
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

	onChanged(listener: (payload: WorkstreamCheckoutHealthPayload) => void): () => void {
		return onPlatformEvent(REPOSITORIES_WORKSTREAM_CHECKOUT_HEALTH_CHANNEL, listener);
	}
}

export const checkoutHealthService = new CheckoutHealthService();
