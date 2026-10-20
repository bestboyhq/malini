import { toast as sonner } from 'svelte-sonner';
import Toast from './Toast.svelte';
import { toastDuration } from './toast-duration';

export type ToastLevel = 'success' | 'error' | 'warning' | 'info' | 'loading';

export type ToastId = string | number;

export interface ToastAction {
	label: string;
	onclick: () => void;
}

export type ToastContext = Readonly<Record<string, string>>;

export interface ToastOptions {
	ttlMs?: number | null;
	action?: ToastAction;
	id?: ToastId;
	context?: ToastContext;
}

export interface ShownToast {
	readonly level: ToastLevel;
	readonly message: string;
	readonly context: ToastContext;
}

export type ToastObserver = (shown: ShownToast) => void;

class ToastStore {
	readonly #observers = new Set<ToastObserver>();

	observe(observer: ToastObserver): () => void {
		this.#observers.add(observer);
		return () => {
			this.#observers.delete(observer);
		};
	}

	show(level: ToastLevel, message: string, options?: ToastOptions): ToastId {
		const { action, ttlMs, id, context } = options ?? {};

		let assignedId: ToastId | undefined = id;
		const dismiss = (): void => {
			if (assignedId !== undefined) sonner.dismiss(assignedId);
		};

		assignedId = sonner.custom(Toast, {
			...(id === undefined ? {} : { id }),
			duration: toastDuration(message, ttlMs, id !== undefined),
			componentProps: { level, message, action, onDismiss: dismiss },
		});

		this.#announce({ level, message, context: context ?? {} });
		return assignedId;
	}

	dismiss(id: ToastId): void {
		sonner.dismiss(id);
	}

	#announce(shown: ShownToast): void {
		for (const observer of [...this.#observers]) {
			try {
				observer(shown);
			} catch {
				continue;
			}
		}
	}
}

export const toastStore = new ToastStore();
