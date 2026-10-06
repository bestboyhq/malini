export interface DesktopRuntimeIdentity {
	productName: string;
	bundleIdentifier: string;
	version: string;
	buildProfile: 'debug' | 'release';
	pid: number;
	executablePath: string;
	executableFingerprint: string;
	appDataRoot: string;
}

export const RENDERER_ERROR_SOURCES = [
	'window-error',
	'unhandled-rejection',
	'console-error',
	'caught',
] as const;

export type RendererErrorSource = (typeof RENDERER_ERROR_SOURCES)[number];

export interface RendererErrorDetail {
	name: string;
	message: string;
	stack: string | null;
}

export interface RendererErrorPayload {
	schemaVersion: 1;
	occurredAt: string;
	source: RendererErrorSource;
	route: string;
	error: RendererErrorDetail;
}

export interface RendererErrorReceipt {
	path: string;
	persistedAt: string;
	sizeBytes: number;
	rotated: boolean;
}

export type NotificationPermissionResult = 'granted' | 'denied' | 'prompt';

export interface LogicalViewport {
	width: number;
	height: number;
}

export type ContainerOwner = 'workstream' | 'shared' | 'extension';

export type OwnershipEvidence = 'label' | 'record' | 'label-and-record';

export interface ComposeLabelOverlay {
	path: string;
	labels: Record<string, string>;
}

export interface DockerOwnershipHandshake {
	bundleIdentifier: string;
	appInstanceId: string;
	composeProject: string;
	overlay: ComposeLabelOverlay;
	composeFiles: string[];
}

export interface StartedContainerInput {
	containerId: string;
	containerName: string;
	workstreamId?: string | null;
	composeProject: string;
	service: string;
	owner: string;
	cwd: string;
}

export interface OwnedContainer {
	containerId: string;
	containerName: string;
	state: string;
	bundleIdentifier: string;
	appInstanceId: string | null;
	workstreamId: string | null;
	composeProject: string | null;
	service: string | null;
	owner: ContainerOwner | null;
	cwd: string | null;
	startedAt: string | null;
	appPid: number | null;
	evidence: OwnershipEvidence;
	startedByThisInstance: boolean;
}

export type InstallSkipReason = 'already-installed' | 'no-manifest' | 'unrecognized-project';

export type InstallStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';

export type InstallOutcomeStatus =
	'skipped' | 'already-running' | 'succeeded' | 'failed' | 'aborted';

export interface ShutdownImpact {
	agentRuns: number;
	containers: number;
}

export interface ShutdownUnfinishedContainer {
	containerId: string;
	containerName: string;
	composeProject: string | null;
	reason: string;
}

export interface ShutdownOutcome {
	containersRemoved: string[];
	containersUnfinished: ShutdownUnfinishedContainer[];
	networksRemoved: string[];
	agentRunsClosed: number;
	timedOut: boolean;
	alreadyReclaimed: boolean;
	durationMs: number;
	errors: string[];
}

export type ExtensionFileKind = 'file' | 'directory';

export interface ExtensionFileStat {
	kind: ExtensionFileKind;
	size: number;
}

export interface ExtensionSourceSnapshot {
	id: string;
	sourceKind: 'local' | 'managed';
	sourcePath: string;
	enabled: boolean;
	watch: boolean;
	manifestJson: string;
	entrypointSource: string;
	fingerprint: string;
	reloadSequence: number;
	loadError: string | null;
}

export interface ManagedExtensionSourceSnapshot extends ExtensionSourceSnapshot {
	sourceKind: 'managed';
	version: string;
	installedAt: string;
	releaseJson: string;
	previousVersions: string[];
}

export interface ExtensionDevelopmentLog {
	timestamp: string;
	level: string;
	extensionId: string | null;
	event: string;
	message: string;
}
