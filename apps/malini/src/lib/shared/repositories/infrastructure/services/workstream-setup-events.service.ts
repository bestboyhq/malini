import type { WorkstreamSetupOutcome } from '$shared/repositories/domain/provisioning';

const WORKSTREAM_SETUP_SETTLED = 'workstream-setup-settled';

class WorkstreamSetupEventsService {
	readonly #target = new EventTarget();

	announce(outcome: WorkstreamSetupOutcome): void {
		this.#target.dispatchEvent(new CustomEvent(WORKSTREAM_SETUP_SETTLED, { detail: outcome }));
	}

	onSettled(listener: (outcome: WorkstreamSetupOutcome) => void): () => void {
		const handle = (event: Event): void => {
			const outcome = setupOutcome(event);
			if (outcome) listener(outcome);
		};
		this.#target.addEventListener(WORKSTREAM_SETUP_SETTLED, handle);
		return () => this.#target.removeEventListener(WORKSTREAM_SETUP_SETTLED, handle);
	}
}

function setupOutcome(event: Event): WorkstreamSetupOutcome | null {
	if (!(event instanceof CustomEvent)) return null;
	const detail: unknown = event.detail;
	if (typeof detail !== 'object' || detail === null) return null;
	const workstreamId: unknown = Reflect.get(detail, 'workstreamId');
	const status: unknown = Reflect.get(detail, 'status');
	if (typeof workstreamId !== 'string') return null;
	if (status !== 'ready' && status !== 'abandoned') return null;
	return { workstreamId, status };
}

export const workstreamSetupEvents = new WorkstreamSetupEventsService();
