import type { OnboardingWhere } from '$lib/app/domain/onboarding';
import type { SidebarShow } from '$lib/app/domain/sidebar-arrangement';
import type { SidebarDensity } from '$lib/app/domain/sidebar-density';

export const WHERE_CHOICES: readonly OnboardingWhere[] = ['many', 'one'];

export const WHERE_LABELS: Readonly<Record<OnboardingWhere, string>> = {
	many: 'Many repositories',
	one: 'One project',
};

export const SHOW_CHOICES: readonly SidebarShow[] = ['everything', 'attention'];

export const SHOW_LABELS: Readonly<Record<SidebarShow, string>> = {
	everything: 'Everything',
	attention: 'Only what needs me',
};

export const DENSITY_CHOICES: readonly SidebarDensity[] = ['compact', 'comfortable'];

export const DENSITY_LABELS: Readonly<Record<SidebarDensity, string>> = {
	compact: 'Compact',
	comfortable: 'Comfortable',
};
