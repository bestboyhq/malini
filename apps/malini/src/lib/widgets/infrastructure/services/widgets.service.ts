import type {
	AllowWidgetKeysArgs,
	PlaceWidgetArgs,
	ResizeWidgetArgs,
	ShareWidgetArgs,
	WidgetArgs,
	WidgetBoard,
	WidgetBoardChangedEvent,
	WidgetReading,
} from '$contract/widgets';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WidgetsService {
	board(workstreamId: string): Promise<WidgetBoard> {
		return invoke('widgets.board', { workstreamId });
	}

	place(args: PlaceWidgetArgs): Promise<WidgetBoard> {
		return invoke('widgets.place', args);
	}

	resize(args: ResizeWidgetArgs): Promise<WidgetBoard> {
		return invoke('widgets.resize', args);
	}

	remove(args: WidgetArgs): Promise<WidgetBoard> {
		return invoke('widgets.remove', args);
	}

	async share(args: ShareWidgetArgs): Promise<void> {
		await invoke('widgets.share', args);
	}

	async pinPlan(repositoryFullName: string): Promise<void> {
		await invoke('widgets.pin-plan', { repositoryFullName });
	}

	async allowKeys(args: AllowWidgetKeysArgs): Promise<void> {
		await invoke('widgets.allow-keys', args);
	}

	async watch(workstreamId: string, watching: boolean): Promise<void> {
		await invoke('widgets.watch', { workstreamId, watching });
	}

	onBoardChanged(listener: (event: WidgetBoardChangedEvent) => void): () => void {
		return onPlatformEvent('widgets:board-changed', listener);
	}

	onReadingChanged(listener: (reading: WidgetReading) => void): () => void {
		return onPlatformEvent('widgets:reading-changed', listener);
	}
}

export const widgetsService = new WidgetsService();
