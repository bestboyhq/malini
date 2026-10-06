import type { ShutdownImpact, ShutdownOutcome } from '$contract/system';

export interface AppPlatform {
	shutdownGracefully(budgetMs?: number): Promise<ShutdownOutcome>;
	shutdownImpact(): ShutdownImpact;
	shutdownUsageData(): Promise<void>;
	windowStateSaved(): Promise<void>;
}

export type { ShellHost } from './platform/shell-host';
export type { ResolvedEnvironment } from './platform/boot-environment';
export { SHUTDOWN_BUDGET_MS } from './platform/graceful-shutdown';
