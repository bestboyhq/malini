import type { CommandCenterMode } from '$lib/app/domain/command-center';

class CommandCenterStore {
	mode: CommandCenterMode | null = $state(null);
}

export const commandCenterStore = new CommandCenterStore();
