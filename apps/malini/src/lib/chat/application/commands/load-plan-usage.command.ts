import { planUsageFromReading } from '$lib/chat/domain/plan-usage';
import { planUsageService } from '$lib/chat/infrastructure/services/plan-usage.service';
import { planUsageStore } from '$lib/chat/infrastructure/stores/plan-usage.store.svelte';

export { loadPlanUsageCommand };

function loadPlanUsageCommand(): void {
	void rememberClaudeReadings().catch(() => undefined);
}

async function rememberClaudeReadings(): Promise<void> {
	const readings = await planUsageService.claudeReadings();
	planUsageStore.remember(readings.flatMap((reading) => planUsageFromReading(reading) ?? []));
}
