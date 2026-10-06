import { APP_NOTIFICATION_OPENED_CHANNEL, type NotificationTarget } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

type NotificationOpenListener = (target: NotificationTarget) => void;

class NotificationService {
	private permissionChecked = false;
	private permissionAvailable = false;
	private readonly openListeners = new Set<NotificationOpenListener>();

	async notify(
		title: string,
		body: string,
		workstreamId: string,
		sessionId: string | null = null,
	): Promise<void> {
		const opens = sessionId ? { workstreamId, sessionId } : null;
		try {
			await this.ensurePermission();
			if (!this.permissionAvailable) {
				this.fallbackToast(title, body, workstreamId, opens);
				return;
			}
			await invoke('app.notify', { options: { title, body, ...(opens ? { opens } : {}) } });
		} catch {
			this.fallbackToast(title, body, workstreamId, opens);
		}
	}

	onOpen(listener: NotificationOpenListener): () => void {
		this.openListeners.add(listener);
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
			this.openListeners.delete(listener);
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

	private fallbackToast(
		title: string,
		body: string,
		workstreamId: string,
		opens: NotificationTarget | null,
	): void {
		toast.info(
			`${title} · ${body}`,
			aboutWorkstream(
				workstreamId,
				opens ? { action: { label: 'Open chat', onclick: () => this.announceOpen(opens) } } : {},
			),
		);
	}

	private announceOpen(target: NotificationTarget): void {
		for (const listener of [...this.openListeners]) listener(target);
	}
}

export const notificationService = new NotificationService();
