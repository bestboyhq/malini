import type {
	ExtensionPanelContext,
	ExtensionPanelInstance,
	ExtensionPanelRegistration,
} from '@malini/extension-api';
import { mount, unmount } from 'svelte';
import type { BrowserElementPrompt } from '$contract/browser';

import { closeBrowserCommand } from '../application/commands/close-browser.command';
import { BROWSER_PANEL_ID } from '../domain/browser-panel';
import BrowserPanel from './BrowserPanel.svelte';

type ElementPromptHandler = (workstreamId: string, picked: BrowserElementPrompt) => void;

type MountedBrowserPanel = Readonly<{
	workstreamId: string | null;
	dispose: () => Promise<void>;
}>;

export function browserInspectorPanel(
	options: Readonly<{ onElementPrompt: ElementPromptHandler }>,
): ExtensionPanelRegistration {
	return {
		id: BROWSER_PANEL_ID,
		label: 'Browser',
		icon: 'browser',
		order: 30,
		defaultVisible: false,
		component: {
			workstreamScope: 'context',
			mount: (target, context) => mountBrowserPanel(target, context, options.onElementPrompt),
		},
		onDidClose: (context) => {
			if (context.workstream) closeBrowserCommand(context.workstream.id);
		},
	};
}

function mountBrowserPanel(
	target: HTMLElement,
	context: ExtensionPanelContext,
	onElementPrompt: ElementPromptHandler,
): ExtensionPanelInstance {
	let mounted = mountFor(target, context.workstream?.id ?? null, onElementPrompt);
	return {
		update: async (next) => {
			const workstreamId = next.workstream?.id ?? null;
			if (workstreamId === mounted.workstreamId) return;
			await mounted.dispose();
			mounted = mountFor(target, workstreamId, onElementPrompt);
		},
		dispose: () => mounted.dispose(),
	};
}

function mountFor(
	target: HTMLElement,
	workstreamId: string | null,
	onElementPrompt: ElementPromptHandler,
): MountedBrowserPanel {
	if (workstreamId === null) return { workstreamId, dispose: async () => undefined };
	const panel = mount(BrowserPanel, { target, props: { workstreamId, onElementPrompt } });
	return { workstreamId, dispose: () => unmount(panel) };
}
