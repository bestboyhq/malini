import { acceptRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/accept-repository-surface.command';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';

export function watchRepositorySurfaceHook(readWorkstreamId: () => string): () => void {
	return repositoryExtensionService.onSurfaceChanged((surface) => {
		acceptRepositorySurfaceCommand(surface.workstreamId ?? readWorkstreamId(), surface);
	});
}
