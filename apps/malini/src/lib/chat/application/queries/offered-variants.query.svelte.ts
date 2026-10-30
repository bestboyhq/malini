import { offeredVariants, type TurnVariant } from '$lib/chat/domain/turn-report';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';

export { offeredVariantsQuery };

const NONE: readonly (readonly TurnVariant[])[] = [];

class OfferedVariantsQuery {
	public readonly data: (workstreamId: string) => readonly (readonly TurnVariant[])[] = $derived.by(
		() => {
			const presented = transcriptAggregate.targetPresentation;
			if (!presented) return () => NONE;
			const offered = offeredVariants(transcriptAggregate.envelopesFor(presented.sessionId));
			return (workstreamId: string) => (workstreamId === presented.workstreamId ? offered : NONE);
		},
	);
}

const offeredVariantsQuery = new OfferedVariantsQuery();
