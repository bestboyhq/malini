import type { ToastContext, ToastOptions } from '$hyper-ui/components/toast';

const WORKSTREAM_KEY = 'workstream';

export function aboutWorkstream(workstreamId: string, options: ToastOptions = {}): ToastOptions {
	return { ...options, context: { ...options.context, [WORKSTREAM_KEY]: workstreamId } };
}

export function workstreamOfToast(context: ToastContext): string | null {
	return context[WORKSTREAM_KEY] ?? null;
}
