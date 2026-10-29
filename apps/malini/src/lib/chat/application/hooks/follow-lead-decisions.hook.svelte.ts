import { untrack } from 'svelte';
import { leadDecisionsAggregate } from '$lib/chat/infrastructure/aggregates/lead-decisions.aggregate.svelte';
import { leadDecisionsService } from '$lib/chat/infrastructure/services/lead-decisions.service';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export function followLeadDecisionsHook(readSessionId: () => string | null): () => void {
	const stopDecisions = leadDecisionsService.onDecisionChanged((decision) =>
		leadDecisionsAggregate.apply(decision),
	);
	const stopDeliveries = leadDecisionsService.onDeliveryChanged((delivery) =>
		leadDecisionsAggregate.applyDelivery(delivery),
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
		stopDecisions();
		stopDeliveries();
	};
}

async function load(sessionId: string): Promise<void> {
	try {
		const [decisions, deliveries] = await Promise.all([
			leadDecisionsService.list(sessionId),
			leadDecisionsService.listDeliveries(sessionId),
		]);
		leadDecisionsAggregate.replace(sessionId, decisions);
		leadDecisionsAggregate.replaceDeliveries(deliveries);
	} catch (error) {
		captureRendererError('caught', error);
	}
}
