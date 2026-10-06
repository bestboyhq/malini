import { toastTextIsKept, type RendererToastPayload } from '$contract/diagnostics';
import { toastStore, type ShownToast } from '$hyper-ui/components/toast';
import { invoke } from '$shared/port/invoke';
import { currentDiagnosticRoute } from './diagnostic-route';
import { workstreamOfToast } from './toast-subject';

const RECORD_WINDOW_MS = 10_000;
const MAX_RECORDS_PER_WINDOW = 30;

type ObserveToasts = (observer: (shown: ShownToast) => void) => () => void;

type PersistToast = (payload: RendererToastPayload) => Promise<unknown>;

type ToastRecordingOptions = {
	observe?: ObserveToasts;
	persist?: PersistToast;
	now?: () => Date;
	route?: () => string;
};

export function installToastRecording(options: ToastRecordingOptions = {}): () => void {
	const observe = options.observe ?? ((observer) => toastStore.observe(observer));
	const persist = options.persist ?? persistToast;
	const now = options.now ?? (() => new Date());
	const route = options.route ?? currentDiagnosticRoute;
	let windowStartedAt = Number.NEGATIVE_INFINITY;
	let recordsInWindow = 0;

	const claimSlot = (timestamp: number): boolean => {
		if (timestamp < windowStartedAt || timestamp - windowStartedAt >= RECORD_WINDOW_MS) {
			windowStartedAt = timestamp;
			recordsInWindow = 0;
		}
		if (recordsInWindow >= MAX_RECORDS_PER_WINDOW) return false;
		recordsInWindow += 1;
		return true;
	};

	return observe((shown) => {
		const occurredAt = now();
		if (!claimSlot(occurredAt.getTime())) return;
		void persistQuietly(persist, {
			schemaVersion: 1,
			occurredAt: occurredAt.toISOString(),
			route: route(),
			level: shown.level,
			text: toastTextIsKept(shown.level) ? shown.message : null,
			workstreamId: workstreamOfToast(shown.context),
		});
	});
}

async function persistQuietly(persist: PersistToast, payload: RendererToastPayload): Promise<void> {
	try {
		await persist(payload);
	} catch {
		return;
	}
}

function persistToast(payload: RendererToastPayload): Promise<unknown> {
	return invoke('app.report-toast', { payload });
}
