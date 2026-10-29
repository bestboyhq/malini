import type { MergedHead } from '$shared/repositories/domain/workstream';
import { mergedHeadsAggregate } from '$shared/repositories/infrastructure/aggregates/merged-heads.aggregate.svelte';

export { noteMergedHeadCommand };

function noteMergedHeadCommand(workstreamId: string, head: MergedHead | null): void {
	mergedHeadsAggregate.note(workstreamId, head);
}
