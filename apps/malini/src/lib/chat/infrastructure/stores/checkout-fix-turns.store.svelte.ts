import type { SessionId } from '$lib/chat/domain/session';

class CheckoutFixTurnsStore {
	byWorkstream: Readonly<Record<string, SessionId | null>> = $state.raw({});

	has(workstreamId: string): boolean {
		return workstreamId in this.byWorkstream;
	}

	begin(workstreamId: string): void {
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: null };
	}

	seat(workstreamId: string, sessionId: SessionId): void {
		if (!this.has(workstreamId)) return;
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: sessionId };
	}

	end(workstreamId: string): void {
		if (!this.has(workstreamId)) return;
		const { [workstreamId]: _ended, ...rest } = this.byWorkstream;
		this.byWorkstream = rest;
	}
}

export const checkoutFixTurnsStore = new CheckoutFixTurnsStore();
