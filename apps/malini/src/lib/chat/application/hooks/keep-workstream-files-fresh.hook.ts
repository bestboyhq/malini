import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
import { refreshWorkstreamFilesCommand } from '$lib/chat/application/commands/refresh-workstream-files.command';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';

export { keepWorkstreamFilesFreshHook };

function keepWorkstreamFilesFreshHook(workstreamId: string): () => void {
	loadWorkstreamFilesCommand(workstreamId);
	return workstreamFiles.onChanged(workstreamId, () => refreshWorkstreamFilesCommand(workstreamId));
}
