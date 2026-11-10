import { onboardingSidebarArrangement, type OnboardingSidebar } from '$lib/app/domain/onboarding';
import { arrangeSidebarCommand } from './arrange-sidebar.command';
import { chooseSidebarDensityCommand } from './choose-sidebar-density.command';

export function applyOnboardingSidebarCommand(choice: OnboardingSidebar): void {
	arrangeSidebarCommand(onboardingSidebarArrangement(choice));
	chooseSidebarDensityCommand(choice.density);
}
