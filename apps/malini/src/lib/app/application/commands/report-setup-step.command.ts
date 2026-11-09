import type { SetupStep, SetupToolState } from '$contract/commands';
import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';

export function reportSetupStepCommand(
	step: SetupStep,
	tools?: Readonly<{ claudeCode: SetupToolState; github: SetupToolState }>,
): void {
	void onboardingService.reportSetupStep(step, tools).catch(() => undefined);
}
