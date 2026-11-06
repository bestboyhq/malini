export type AutomationsView = 'overview' | 'activity' | 'explorer' | 'recipes';

const VIEWS: Readonly<Record<string, AutomationsView>> = {
	'/automations/activity': 'activity',
	'/automations/explorer': 'explorer',
	'/automations/recipes': 'recipes',
};

export function automationsView(routeId: string | null): AutomationsView {
	return (routeId ? VIEWS[routeId] : undefined) ?? 'overview';
}
