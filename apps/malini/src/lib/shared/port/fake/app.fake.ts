import type { DiagnosticEntry } from '$contract/diagnostics';
import type { NotificationPermissionResult } from '$contract/system';
import type { FakeBridge } from './fake-bridge';
import { FAKE_RUNTIME_IDENTITY } from './fake-constants';
import type { FakeState } from './state';

export function installAppFake(bridge: FakeBridge, state: FakeState): void {
	const diagnostics: DiagnosticEntry[] = [];
	bridge.onReset(() => {
		diagnostics.length = 0;
	});

	bridge.define('app.get-secret', async (input) => {
		return state.secrets.get(secretKey(input.service, input.key)) ?? null;
	});

	bridge.define('app.set-secret', async (input) => {
		state.secrets.set(secretKey(input.service, input.key), input.value);
	});

	bridge.define('app.delete-secret', async (input) => {
		state.secrets.delete(secretKey(input.service, input.key));
	});

	bridge.define('app.runtime-identity', async () => {
		return { ...FAKE_RUNTIME_IDENTITY };
	});

	bridge.define('app.focus-window', async () => {});

	bridge.define('app.open-external-url', async () => {});

	bridge.define('app.copy-text', async () => {});

	bridge.define('app.interface-scale', async (input) => {
		if (typeof document !== 'undefined') {
			document.documentElement.style.zoom = `${input.scale}`;
		}
	});

	bridge.define('app.notification-permission-granted', async () => {
		return true;
	});

	bridge.define(
		'app.request-notification-permission',
		async (): Promise<NotificationPermissionResult> => 'granted',
	);

	bridge.define('app.list-settings', async () => {
		return { ...state.settings };
	});

	bridge.define('app.set-setting', async (input) => {
		state.settings[input.key] = input.value;
	});

	bridge.define('app.report-renderer-error', async (input) => ({
		path: `${FAKE_RUNTIME_IDENTITY.appDataRoot}/diagnostics/renderer-errors.ndjson`,
		persistedAt: input.payload.occurredAt,
		sizeBytes: new TextEncoder().encode(`${JSON.stringify(input.payload)}\n`).byteLength,
		rotated: false,
	}));

	bridge.define('app.report-toast', async (input) => {
		diagnostics.push({
			occurredAt: input.payload.occurredAt,
			process: 'renderer',
			level: toastDiagnosticLevel(input.payload.level),
			source: 'toast',
			message: input.payload.text ?? `${input.payload.level} toast, text not kept`,
			detail: null,
			errorName: null,
			code: null,
			command: null,
			durationMs: null,
			suppressedRepeats: 0,
			workstreamId: input.payload.workstreamId,
			viewing: viewedWorkstream(input.payload.route),
			route: input.payload.route,
		});
		return {
			path: `${FAKE_RUNTIME_IDENTITY.appDataRoot}/diagnostics/renderer-errors.ndjson`,
			persistedAt: input.payload.occurredAt,
			sizeBytes: new TextEncoder().encode(`${JSON.stringify(input.payload)}\n`).byteLength,
			rotated: false,
		};
	});

	bridge.define('app.recent-diagnostics', async (input) =>
		diagnostics.slice(-input.limit).reverse(),
	);

	bridge.define('app.notify', async () => undefined);
	bridge.define('app.take-notification-target', async () => null);

	bridge.define('app.runtime-info', async () => ({
		app: FAKE_RUNTIME_IDENTITY.version,
		electron: '0.0.0-fake',
		node: '0.0.0-fake',
		chrome: '0.0.0-fake',
		sqlite: '0.0.0-fake',
		dataDirectory: FAKE_RUNTIME_IDENTITY.appDataRoot,
	}));

	bridge.define('app.logical-viewport', async () => ({ width: 1440, height: 900 }));

	bridge.define('app.close-guard', async () => undefined);

	bridge.define('app.destroy-window', async () => undefined);

	bridge.define('app.shutdown-impact', async () => ({ agentRuns: 0, containers: 0 }));

	bridge.define('app.shutdown-gracefully', async () => ({
		containersRemoved: [],
		containersUnfinished: [],
		networksRemoved: [],
		agentRunsClosed: 0,
		timedOut: false,
		alreadyReclaimed: false,
		durationMs: 0,
		errors: [],
	}));
}

function toastDiagnosticLevel(level: string): DiagnosticEntry['level'] {
	if (level === 'error') return 'error';
	if (level === 'warning') return 'warn';
	return 'info';
}

function viewedWorkstream(route: string): string | null {
	return /^\/workstreams\/([^/?#]+)/u.exec(route)?.[1] ?? null;
}

function secretKey(service: string, key: string): string {
	return `${service}:${key}`;
}
