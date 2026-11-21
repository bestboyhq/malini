import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { mount, unmount } from 'svelte';
import type { ScratchpadStart } from '../domain/scratchpad';
import ScratchpadPanel from './ScratchpadPanel.svelte';

export const SCRATCHPAD_PANEL_ID = 'malini.notes';

export function scratchpadPanel(
	onstartworkstream: (workstreamId: string, start: ScratchpadStart) => void,
): ExtensionPanelRegistration {
	return {
		id: SCRATCHPAD_PANEL_ID,
		label: 'Notes',
		icon: 'notes',
		order: 20,
		defaultVisible: false,
		component: {
			workstreamScope: 'context',
			mount: (target, { workstream }) => {
				if (!workstream?.repositoryFullName) return { dispose: () => undefined };
				const panel = mount(ScratchpadPanel, {
					target,
					props: {
						repositoryFullName: workstream.repositoryFullName,
						onstartworkstream: (start) => onstartworkstream(workstream.id, start),
					},
				});
				return { dispose: () => unmount(panel) };
			},
		},
	};
}
