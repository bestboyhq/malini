export type ExtensionsPageView = 'discover' | 'installed' | 'published' | 'detail';

const VIEWS: Readonly<Record<string, ExtensionsPageView>> = {
	'/extensions/installed': 'installed',
	'/extensions/published': 'published',
	'/extensions/[publisher]/[name]': 'detail',
};

export function extensionsView(routeId: string | null): ExtensionsPageView {
	return (routeId ? VIEWS[routeId] : undefined) ?? 'discover';
}
