import { invoke } from '$shared/port/invoke';

class ScratchpadService {
	load(repositoryFullName: string): Promise<string | null> {
		return invoke('scratchpad.load', { repositoryFullName });
	}

	async save(repositoryFullName: string, content: string): Promise<void> {
		await invoke('scratchpad.save', { repositoryFullName, content });
	}
}

export const scratchpadService = new ScratchpadService();
