import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
import { refreshWorkstreamFilesCommand } from '$lib/chat/application/commands/refresh-workstream-files.command';
import { refreshWorkstreamImagesCommand } from '$lib/chat/application/commands/refresh-workstream-images.command';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';
import { checkoutHealthQuery } from '$shared/repositories/repositories.api';

export { keepWorkstreamFilesFreshHook };

function keepWorkstreamFilesFreshHook(workstreamId: string): () => void {
	loadWorkstreamFilesCommand(workstreamId);
	const stopChanges = workstreamFiles.onChanged(workstreamId, (changedPaths) => {
		if (checkoutHealthQuery.data(workstreamId).state !== 'healthy') return;
		refreshWorkstreamFilesCommand(workstreamId);
		refreshWorkstreamImagesCommand(workstreamId, changedPaths);
	});
	const stopHealed = workstreamFiles.onCheckoutHealed(workstreamId, () => {
		loadWorkstreamFilesCommand(workstreamId);
		refreshWorkstreamFilesCommand(workstreamId);
		refreshWorkstreamImagesCommand(workstreamId, null);
	});
	return () => {
		stopChanges();
		stopHealed();
	};
}
