export const ONBOARDING_FINISHED_SETTING = 'onboarding.finished-at';

export type OnboardingStep = 'claude-code' | 'skills' | 'jobs' | 'repository';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	'claude-code',
	'skills',
	'jobs',
	'repository',
];

export function onboardingFinished(setting: string | null | undefined): boolean {
	return typeof setting === 'string' && setting.length > 0;
}

export function clampOnboardingStep(index: number): number {
	return Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
}
