export type SidebarDensity = 'comfortable' | 'compact';

export const SIDEBAR_DENSITIES: readonly SidebarDensity[] = ['comfortable', 'compact'];

export function parseSidebarDensity(raw: string | null): SidebarDensity {
	return SIDEBAR_DENSITIES.find((density) => density === raw) ?? 'comfortable';
}
