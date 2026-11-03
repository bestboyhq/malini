import type { CommandCenterMode } from '$lib/app/domain/command-center';
import { commandCenterStore } from '$lib/app/infrastructure/stores/command-center.store.svelte';

class CommandCenterQuery {
	public readonly data: CommandCenterMode | null = $derived(commandCenterStore.mode);
}

export const commandCenterQuery = new CommandCenterQuery();
