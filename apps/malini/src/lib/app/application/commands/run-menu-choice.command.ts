import type { MenuCommand } from '$contract/events';
import { startFreshChatCommand } from '$lib/chat/application/commands/start-fresh-chat.command';
import {
	createWorkstreamHereCommand,
	requestRepositoryConnectionCommand,
} from '$shared/repositories/repositories.api';
import { back, goto } from '$shared/router/navigation';
import { SETTINGS_HREF } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';

export { runMenuChoiceCommand };

const MENU_CHOICES: Readonly<Record<MenuCommand, () => void>> = {
	'new-workstream': createWorkstreamHereCommand,
	'new-chat': startChatHere,
	'open-folder': () => requestRepositoryConnectionCommand('folder'),
	'clone-repository': () => requestRepositoryConnectionCommand('clone'),
	settings: () => void goto(SETTINGS_HREF),
};

function runMenuChoiceCommand(command: MenuCommand): void {
	const run = MENU_CHOICES[command];
	if (command === 'settings' || page.state.settings === undefined) {
		run();
		return;
	}
	void (async () => {
		await back();
		run();
	})();
}

function startChatHere(): void {
	const workstreamId = page.params.workstreamId;
	if (!workstreamId) return;
	workstreamTabs.startFreshChat(workstreamId);
	void startFreshChatCommand();
}
