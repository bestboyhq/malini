import { APP_NOTIFICATION_OPENED_CHANNEL, type NotificationTarget } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';
import { drawTrayBadge } from './tray-badge';

type NotificationOpenListener = (target: NotificationTarget) => void;

class NotificationService {
	private permissionChecked = false;
	private permissionAvailable = false;
	private shownCount = 0;

	async notify(
		title: string,
		body: string,
		workstreamId: string,
		sessionId: string | null = null,
	): Promise<void> {
		const opens = sessionId ? { workstreamId, sessionId } : null;
		try {
			await this.ensurePermission();
			if (!this.permissionAvailable) return;
			await invoke('app.notify', { options: { title, body, ...(opens ? { opens } : {}) } });
		} catch {
			return;
		}
	}

	async showUnreadCount(count: number): Promise<void> {
		this.shownCount = count;
		const icon = await drawTrayBadge(count);
		if (count !== this.shownCount) return;
		await invoke('app.unread-chats', { count, icon });
	}

	onOpen(listener: NotificationOpenListener): () => void {
		let listening = true;
		const openClicked = async (): Promise<void> => {
			const target = await invoke('app.take-notification-target', undefined).catch(() => null);
			if (!listening || !target) return;
			if (typeof target.workstreamId !== 'string' || typeof target.sessionId !== 'string') return;
			listener({ workstreamId: target.workstreamId, sessionId: target.sessionId });
		};
		const stopNative = onPlatformEvent(APP_NOTIFICATION_OPENED_CHANNEL, () => void openClicked());
		void openClicked();
		return () => {
			listening = false;
			stopNative();
		};
	}

	private async ensurePermission(): Promise<void> {
		if (this.permissionChecked) return;
		this.permissionChecked = true;
		try {
			if ((await invoke('app.notification-permission-granted', undefined)) === true) {
				this.permissionAvailable = true;
				return;
			}
			const requested = await invoke('app.request-notification-permission', undefined);
			this.permissionAvailable = requested === 'granted';
		} catch {
			this.permissionAvailable = false;
		}
	}
}

export const notificationService = new NotificationService();
