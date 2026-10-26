export type JobsView = 'overview' | 'activity' | 'timeline' | 'recipes';

const VIEWS: Readonly<Record<string, JobsView>> = {
	'/jobs/activity': 'activity',
	'/jobs/timeline': 'timeline',
	'/jobs/recipes': 'recipes',
};

export function jobsView(routeId: string | null): JobsView {
	return (routeId ? VIEWS[routeId] : undefined) ?? 'overview';
}
