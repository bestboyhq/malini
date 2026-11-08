import type { ClaudeCodeStatus } from '$shared/providers/domain/claude-code-status';
import type { GitHubSetupStatus } from '$shared/repositories/domain/github-auth';

export const ONBOARDING_FINISHED_SETTING = 'onboarding.finished-at';

export type OnboardingStep = 'accounts' | 'sounds' | 'defaults' | 'heard-about';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	'accounts',
	'sounds',
	'defaults',
	'heard-about',
];

export type OnboardingScreen = 'setup' | 'picker';

export type OnboardingAccount = 'claude-code' | 'github';

export type OnboardingAccountStatus = ClaudeCodeStatus['kind'] | GitHubSetupStatus;

export type OnboardingAccountStatuses = Readonly<
	Record<OnboardingAccount, OnboardingAccountStatus>
>;

export const ONBOARDING_ACCOUNTS: readonly OnboardingAccount[] = ['claude-code', 'github'];

export function onboardingFinished(setting: string | null | undefined): boolean {
	return typeof setting === 'string' && setting.length > 0;
}

export function clampOnboardingStep(index: number): number {
	return Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
}

const SETTLED_STATUSES: readonly OnboardingAccountStatus[] = ['ready', 'unknown'];

export function onboardingAccountsSettled(statuses: OnboardingAccountStatuses): boolean {
	return ONBOARDING_ACCOUNTS.every((account) => SETTLED_STATUSES.includes(statuses[account]));
}

export function claudeCodeOnboardingStatus(
	status: ClaudeCodeStatus['kind'],
): OnboardingAccountStatus {
	return status === 'signed-out' ? 'ready' : status;
}

export function openOnboardingAccount(
	statuses: OnboardingAccountStatuses,
	chosen: OnboardingAccount | null,
): OnboardingAccount | null {
	if (chosen !== null && statuses[chosen] !== 'ready') return chosen;
	for (const account of ONBOARDING_ACCOUNTS) {
		if (statuses[account] === 'checking') return null;
		if (statuses[account] !== 'ready') return account;
	}
	return null;
}
