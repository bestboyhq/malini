import type { CommandCenterMode } from '$lib/app/domain/command-center';
import { commandCenterStore } from '$lib/app/infrastructure/stores/command-center.store.svelte';

export function openCommandCenterCommand(mode: CommandCenterMode): void {
	commandCenterStore.mode = mode;
}
