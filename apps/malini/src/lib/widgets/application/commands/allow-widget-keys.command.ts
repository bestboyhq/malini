import { toast } from '$hyper-ui/components/toast';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { allowWidgetKeysCommand };

async function allowWidgetKeysCommand(
	workstreamId: string,
	widgetId: string,
	values: Readonly<Record<string, string>>,
): Promise<boolean> {
	try {
		await widgetsService.allowKeys({ workstreamId, widgetId, values });
		return true;
	} catch (error) {
		const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
		toast.error(`Key not saved${detail ? ` · ${detail}` : ''}.`);
		return false;
	}
}
