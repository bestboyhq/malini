import { toastStore, type ToastId, type ToastLevel, type ToastOptions } from './toast.store.svelte';

function show(level: ToastLevel, message: string, options?: ToastOptions): ToastId {
	return toastStore.show(level, message, options);
}

export const toast = {
	success(message: string, options?: ToastOptions): ToastId {
		return show('success', message, options);
	},
	error(message: string, options?: ToastOptions): ToastId {
		return show('error', message, options);
	},
	warning(message: string, options?: ToastOptions): ToastId {
		return show('warning', message, options);
	},
	info(message: string, options?: ToastOptions): ToastId {
		return show('info', message, options);
	},
	loading(message: string, options?: ToastOptions): ToastId {
		return show('loading', message, { ttlMs: null, ...options });
	},
	dismiss(id: ToastId): void {
		toastStore.dismiss(id);
	},
};

export type { ToastId, ToastOptions };
