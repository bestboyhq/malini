export type JobsView = 'overview' | 'activity' | 'recipes' | 'routines';

const VIEWS: Readonly<Record<string, JobsView>> = {
	'/jobs/activity': 'activity',
	'/jobs/recipes': 'recipes',
	'/jobs/routines': 'routines',
};

export function jobsView(routeId: string | null): JobsView {
	return (routeId ? VIEWS[routeId] : undefined) ?? 'overview';
}
