import { SETUP_STEPS, type SetupStep } from '$contract/commands';
import type { ClaudeCodeStatus } from '$shared/providers/domain/claude-code-status';
import type { GitHubSetupStatus } from '$shared/repositories/domain/github-auth';
import {
	DEFAULT_SIDEBAR_ARRANGEMENT,
	sectionedGrouping,
	type SidebarArrangement,
	type SidebarShow,
} from './sidebar-arrangement';
import type { SidebarDensity } from './sidebar-density';

export const ONBOARDING_FINISHED_SETTING = 'onboarding.finished-at';

export type OnboardingStep = SetupStep;

export const ONBOARDING_STEPS: readonly OnboardingStep[] = SETUP_STEPS;

export type OnboardingWhere = 'many' | 'one';

export type OnboardingSidebar = Readonly<{
	where: OnboardingWhere;
	show: SidebarShow;
	density: SidebarDensity;
}>;

export const DEFAULT_ONBOARDING_SIDEBAR: OnboardingSidebar = {
	where: 'many',
	show: 'everything',
	density: 'compact',
};

export type SidebarPreset = Pick<OnboardingSidebar, 'where' | 'show'>;

export function onboardingSidebarArrangement({ where, show }: SidebarPreset): SidebarArrangement {
	if (where === 'many' && show === 'everything') return DEFAULT_SIDEBAR_ARRANGEMENT;
	return {
		...DEFAULT_SIDEBAR_ARRANGEMENT,
		grouping: 'status',
		subgrouping: where === 'many' ? 'repository' : 'none',
		show,
	};
}

export function sidebarPreset({ grouping, subgrouping, show }: SidebarArrangement): SidebarPreset {
	return {
		where: sectionedGrouping(grouping) && subgrouping === 'none' ? 'one' : 'many',
		show,
	};
}

export function presetArranged(
	current: SidebarArrangement,
	change: Partial<SidebarPreset>,
): SidebarArrangement {
	return {
		...onboardingSidebarArrangement({ ...sidebarPreset(current), ...change }),
		ordering: current.ordering,
	};
}

export function customArrangement(arrangement: SidebarArrangement): boolean {
	const preset = onboardingSidebarArrangement(sidebarPreset(arrangement));
	return (
		arrangement.grouping !== preset.grouping ||
		arrangement.subgrouping !== preset.subgrouping ||
		arrangement.ordering !== 'manual'
	);
}

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

export function onboardingToolsSettled(statuses: OnboardingToolStatuses): boolean {
	return ONBOARDING_TOOLS.every((tool) => SETTLED_STATUSES.includes(statuses[tool]));
}

export function claudeCodeOnboardingStatus(status: ClaudeCodeStatus['kind']): OnboardingToolStatus {
	return status === 'signed-out' ? 'ready' : status;
}
