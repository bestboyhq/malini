import { invoke } from '$shared/port/invoke';
import { RepositoryAvatarMapper } from '$shared/repositories/infrastructure/mappers/repository-avatar.mapper';

class RepositoryAvatarsService {
	async ownerAvatarUrl(owner: string): Promise<string | null> {
		return RepositoryAvatarMapper.fromRaw(await invoke('repositories.owner-avatar', { owner }));
	}
}

export const repositoryAvatarsService = new RepositoryAvatarsService();
