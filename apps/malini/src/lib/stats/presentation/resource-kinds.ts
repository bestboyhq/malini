import type { ResourceKind } from '$contract/stats';
import type { IconName } from '$hyper-ui/icons';

export type ResourceKindDisplay = Readonly<{
	label: string;
	description: string;
	icon: IconName;
}>;

const DISPLAY: Readonly<Record<ResourceKind, ResourceKindDisplay>> = {
	malini: {
		label: 'malini',
		description: 'The app itself: its window, main process and helpers.',
		icon: 'sidebar',
	},
	browser: {
		label: 'Browser tabs',
		description: 'Pages open in browser tabs.',
		icon: 'globe',
	},
	agents: {
		label: 'Agents',
		description: 'Claude Code, one process per open chat, and the bridge that runs them.',
		icon: 'sparkles',
	},
	tools: {
		label: 'Started by agents',
		description: 'Programs agents launched: MCP servers, dev servers, test runners and shells.',
		icon: 'terminal',
	},
	docker: {
		label: 'Docker',
		description: 'Containers malini runs for your workstreams.',
		icon: 'cube',
	},
};

export function resourceKindDisplay(kind: ResourceKind): ResourceKindDisplay {
	return DISPLAY[kind];
}
