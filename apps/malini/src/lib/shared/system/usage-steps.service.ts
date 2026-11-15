import type { UsageStep } from '$contract/system';
import { invoke } from '$shared/port/invoke';

class UsageStepsService {
	count(step: UsageStep): void {
		invoke('app.count-usage-step', step).catch(() => undefined);
	}
}

export const usageStepsService = new UsageStepsService();
