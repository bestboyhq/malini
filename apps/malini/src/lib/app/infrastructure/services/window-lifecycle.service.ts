import type { ShutdownImpact, ShutdownOutcome } from '$contract/system';
import { hasPlatformBridge, onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WindowLifecycleService {
	isNativeWindow(): boolean {
		return hasPlatformBridge();
	}

	readShutdownImpact(): Promise<ShutdownImpact> {
		return invoke('app.shutdown-impact', undefined);
	}

	async armCloseGuard(handler: () => void): Promise<() => void> {
		const unlisten = onPlatformEvent('app:close-requested', () => {
			handler();
		});
		try {
			await invoke('app.close-guard', { armed: true });
		} catch (error) {
			unlisten();
			throw error;
		}
		return () => {
			unlisten();
			void invoke('app.close-guard', { armed: false }).catch(() => undefined);
		};
	}

	async confirmShutdownAndClose(): Promise<ShutdownOutcome | null> {
		let outcome: ShutdownOutcome | null = null;
		try {
			outcome = await invoke('app.shutdown-gracefully', undefined);
		} catch (error) {
			console.error('[malini lifecycle] the graceful shutdown could not finish', error);
		}
		if (outcome && outcome.errors.length > 0) {
			console.error('[malini lifecycle] the shutdown finished with errors', outcome.errors);
		}
		await invoke('app.destroy-window', undefined);
		return outcome;
	}
}

export const windowLifecycleService = new WindowLifecycleService();
