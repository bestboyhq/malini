import type { SecretRequest } from '$contract/secrets';

class SecretRequestsAggregate {
	bySession = $state.raw<ReadonlyMap<string, SecretRequest>>(new Map());

	replace(sessionId: string, requests: readonly SecretRequest[]): void {
		const latest = requests.at(-1);
		const next = new Map(this.bySession);
		if (latest) next.set(sessionId, latest);
		else next.delete(sessionId);
		this.bySession = next;
	}

	open(request: SecretRequest): void {
		this.bySession = new Map(this.bySession).set(request.sessionId, request);
	}

	close(sessionId: string, requestId: string): void {
		if (this.bySession.get(sessionId)?.id !== requestId) return;
		const next = new Map(this.bySession);
		next.delete(sessionId);
		this.bySession = next;
	}
}

export const secretRequestsAggregate = new SecretRequestsAggregate();
