import { toast } from '$hyper-ui/components/toast';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { cancelWidgetConnectCommand, connectWidgetCommand };

async function connectWidgetCommand(workstreamId: string, widgetId: string): Promise<void> {
	try {
		await widgetsService.connect({ workstreamId, widgetId });
	} catch (error) {
		const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
		toast.error(`Not connected${detail ? ` · ${detail}` : ''}.`);
	}
}

function cancelWidgetConnectCommand(): void {
	void widgetsService.cancelConnect().catch(() => undefined);
}
