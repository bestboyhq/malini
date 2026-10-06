import { workstreamHref } from '$shared/router/routes-hrefs';

export type ExtensionDirectoryLocation = Readonly<{
	workstreamId: string;
	agentSessionId?: string | null;
}>;

export function extensionInspectorHref(location: ExtensionDirectoryLocation): string {
	return workstreamHref(location.workstreamId, {
		agentSessionId: location.agentSessionId ?? null,
	});
}

export function extensionDirectoryHref(
	location: ExtensionDirectoryLocation,
	extensionId?: string,
): string {
	return workstreamHref(location.workstreamId, {
		agentSessionId: location.agentSessionId ?? null,
		inspector: 'extensions',
		extension: extensionId ?? null,
	});
}
