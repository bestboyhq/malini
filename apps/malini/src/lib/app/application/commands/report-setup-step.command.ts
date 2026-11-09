import type { SetupAccountState, SetupStep } from '$contract/commands';
import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';

export function reportSetupStepCommand(
	step: SetupStep,
	accounts?: Readonly<{ claudeCode: SetupAccountState; github: SetupAccountState }>,
): void {
	void onboardingService.reportSetupStep(step, accounts).catch(() => undefined);
}
