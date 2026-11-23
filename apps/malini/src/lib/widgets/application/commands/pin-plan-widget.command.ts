import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { pinPlanWidgetCommand };

function pinPlanWidgetCommand(repositoryFullName: string): void {
	void widgetsService.pinPlan(repositoryFullName).catch(() => undefined);
}
