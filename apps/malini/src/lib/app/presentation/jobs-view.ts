export type JobsView = 'overview' | 'activity' | 'explorer' | 'recipes';

const VIEWS: Readonly<Record<string, JobsView>> = {
	'/jobs/activity': 'activity',
	'/jobs/explorer': 'explorer',
	'/jobs/recipes': 'recipes',
};

export function jobsView(routeId: string | null): JobsView {
	return (routeId ? VIEWS[routeId] : undefined) ?? 'overview';
}
