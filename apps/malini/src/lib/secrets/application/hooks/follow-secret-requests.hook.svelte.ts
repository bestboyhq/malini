import { untrack } from 'svelte';
import { secretRequestsAggregate } from '$lib/secrets/infrastructure/aggregates/secret-requests.aggregate.svelte';
import { secretsService } from '$lib/secrets/infrastructure/services/secrets.service';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export function followSecretRequestsHook(readSessionId: () => string | null): () => void {
	const stopRequested = secretsService.onRequested((request) =>
		secretRequestsAggregate.open(request),
	);
	const stopClosed = secretsService.onRequestClosed(({ sessionId, requestId }) =>
		secretRequestsAggregate.close(sessionId, requestId),
	);
	const stop = $effect.root(() => {
		$effect(() => {
			const sessionId = readSessionId();
			if (sessionId === null) return;
			untrack(() => void load(sessionId));
		});
	});
	return () => {
		stop();
		stopRequested();
		stopClosed();
	};
}

async function load(sessionId: string): Promise<void> {
	try {
		secretRequestsAggregate.replace(sessionId, await secretsService.listRequests(sessionId));
	} catch (error) {
		captureRendererError('caught', error);
	}
}
