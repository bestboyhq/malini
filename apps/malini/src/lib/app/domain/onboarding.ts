import { SETUP_STEPS, type SetupStep } from '$contract/commands';
import type { ClaudeCodeStatus } from '$shared/providers/domain/claude-code-status';
import type { GitHubSetupStatus } from '$shared/repositories/domain/github-auth';

export const ONBOARDING_FINISHED_SETTING = 'onboarding.finished-at';

export type OnboardingStep = SetupStep;

export const ONBOARDING_STEPS: readonly OnboardingStep[] = SETUP_STEPS;

export type OnboardingScreen = 'setup' | 'picker';

export type OnboardingTool = 'claude-code' | 'github';

export type OnboardingToolStatus = ClaudeCodeStatus['kind'] | GitHubSetupStatus;

export type OnboardingToolStatuses = Readonly<Record<OnboardingTool, OnboardingToolStatus>>;

export const ONBOARDING_TOOLS: readonly OnboardingTool[] = ['claude-code', 'github'];

export function onboardingFinished(setting: string | null | undefined): boolean {
	return typeof setting === 'string' && setting.length > 0;
}

export function clampOnboardingStep(index: number): number {
	return Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
}

const SETTLED_STATUSES: readonly OnboardingToolStatus[] = ['ready', 'unknown'];

const SKIPPABLE_STATUSES: readonly OnboardingToolStatus[] = ['missing', 'signed-out'];

export function onboardingToolsSettled(statuses: OnboardingToolStatuses): boolean {
	return ONBOARDING_TOOLS.every((tool) => SETTLED_STATUSES.includes(statuses[tool]));
}

export function onboardingToolsSkippable(statuses: OnboardingToolStatuses): boolean {
	return ONBOARDING_TOOLS.some((tool) => SKIPPABLE_STATUSES.includes(statuses[tool]));
}

export function claudeCodeOnboardingStatus(status: ClaudeCodeStatus['kind']): OnboardingToolStatus {
	return status === 'signed-out' ? 'ready' : status;
}

export function openOnboardingTool(
	statuses: OnboardingToolStatuses,
	chosen: OnboardingTool | null,
): OnboardingTool | null {
	if (chosen !== null && statuses[chosen] !== 'ready') return chosen;
	for (const tool of ONBOARDING_TOOLS) {
		if (statuses[tool] === 'checking') return null;
		if (statuses[tool] !== 'ready') return tool;
	}
	return null;
}
