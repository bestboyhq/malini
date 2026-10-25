import type { IconName } from '$hyper-ui/icons';
import type {
	SidebarGrouping,
	SidebarOrdering,
	SidebarSubgrouping,
} from '$lib/app/domain/sidebar-arrangement';
import type { SidebarSectionKey } from '$lib/app/domain/sidebar-sections';

export const GROUPING_ICONS: Readonly<Record<SidebarGrouping, IconName>> = {
	owner: 'users',
	repository: 'book',
	status: 'circle-dot',
	day: 'calendar',
};

export const SUBGROUPING_ICONS: Readonly<Record<SidebarSubgrouping, IconName>> = {
	none: 'circle-slash',
	owner: 'users',
	repository: 'book',
};

export const ORDERING_ICONS: Readonly<Record<SidebarOrdering, IconName>> = {
	manual: 'grip',
	active: 'clock',
	newest: 'calendar',
	name: 'text',
};

export const SECTION_ICONS: Readonly<
	Record<SidebarSectionKey, Readonly<{ name: IconName; tone: string }> | null>
> = {
	'needs-you': { name: 'alert', tone: 'text-warning-content' },
	'in-progress': { name: 'contrast', tone: 'text-brand-icon' },
	'in-review': { name: 'pr-open', tone: 'text-fg-tertiary' },
	idle: { name: 'circle', tone: 'text-fg-tertiary' },
	stale: { name: 'clock', tone: 'text-fg-quaternary' },
	merged: { name: 'pr-merged', tone: 'text-merged-content' },
	today: null,
	yesterday: null,
	older: null,
};
