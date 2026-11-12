import type { SidebarGrouping } from '$lib/app/domain/sidebar-arrangement';
import {
	daySection,
	statusSection,
	type SidebarSectionKey,
} from '$lib/app/domain/sidebar-sections';
import { workstreamActivityQuery } from '$lib/chat/application/queries/workstream-activity.query.svelte';
import { pullRequestBadgesQuery } from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
import type { Workstream } from '$shared/repositories/repositories.api';
import { startedProgressQuery } from './started-progress.query.svelte';

class SidebarSectionsQuery {
	public readonly activeAt: (workstream: Workstream) => number = $derived(
		(workstream: Workstream) =>
			Math.max(
				Date.parse(workstream.activeAt) || 0,
				workstreamActivityQuery.activeAt(workstream.id) ?? 0,
			),
	);

	public readonly sectionOf: (
		grouping: SidebarGrouping,
		now: number,
	) => (workstream: Workstream) => SidebarSectionKey = $derived(
		(grouping: SidebarGrouping, now: number) => (workstream: Workstream) => {
			const activeAt = this.activeAt(workstream);
			return grouping === 'day'
				? daySection(activeAt, now)
				: statusSection({
						dot: startedProgressQuery.dot(workstream),
						pullRequest: pullRequestBadgesQuery.data(workstream.id).phase,
						activeAt,
						now,
					});
		},
	);
}

export const sidebarSectionsQuery = new SidebarSectionsQuery();
