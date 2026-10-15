import type { ResourceKind } from '$contract/stats';
import type { IconName } from '$hyper-ui/icons';

export type ResourceKindDisplay = Readonly<{
	label: string;
	icon: IconName;
	unit: [string, string];
}>;

const DISPLAY: Readonly<Record<ResourceKind, ResourceKindDisplay>> = {
	malini: { label: 'malini', icon: 'sidebar', unit: ['process', 'processes'] },
	browser: { label: 'Browser tabs', icon: 'globe', unit: ['process', 'processes'] },
	agents: { label: 'Agents', icon: 'sparkles', unit: ['process', 'processes'] },
	tools: { label: 'Tools agents started', icon: 'terminal', unit: ['process', 'processes'] },
	docker: { label: 'Docker', icon: 'cube', unit: ['container', 'containers'] },
};

export function resourceKindDisplay(kind: ResourceKind): ResourceKindDisplay {
	return DISPLAY[kind];
}
