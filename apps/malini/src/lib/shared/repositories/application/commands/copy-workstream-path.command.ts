import { toast } from '$hyper-ui/components/toast';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyWorkstreamPathCommand };

function copyWorkstreamPathCommand(
	input: Readonly<{ workstreamId: string; path: string; absolute: boolean }>,
): void {
	const root = workstreamsAggregate.workstreams.find(({ id }) => id === input.workstreamId)?.path;
	if (input.absolute && !root) {
		toast.error('Could not copy the path · this workstream has no checkout yet');
		return;
	}
	const text = input.absolute && root ? `${root.replace(/\/+$/u, '')}/${input.path}` : input.path;
	void (async () => {
		try {
			await clipboardService.write(text);
		} catch (error: unknown) {
			toast.error(
				`Could not copy the path · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
