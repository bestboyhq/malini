import type { UsageStep } from '$contract/system';
import { usageStepsService } from '$shared/system/usage-steps.service';

export function countUsageStepCommand(step: UsageStep): void {
	usageStepsService.count(step);
}
