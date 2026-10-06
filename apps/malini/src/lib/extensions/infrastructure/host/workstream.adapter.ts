import type { ExtensionAPI, ExtensionWorkstream } from '@malini/extension-api';

import { invoke } from '$shared/port/invoke';

export function createDesktopExtensionWorkstream(input: {
	extensionId: string;
	workstream: () => ExtensionWorkstream | null;
	knownWorkstreams?: () => readonly ExtensionWorkstream[];
}): ExtensionAPI['workstream'] {
	const knownWorkstreams = input.knownWorkstreams;
	const workstreamId = (requested?: string): string => {
		if (requested) return requested;
		const current = input.workstream();
		if (!current) throw new Error('Extension workstream operation requires an active workstream');
		return current.id;
	};

	return {
		current: input.workstream,
		...(knownWorkstreams
			? {
					list: async (): Promise<readonly ExtensionWorkstream[]> =>
						knownWorkstreams().map((workstream) => ({ ...workstream })),
				}
			: {}),
		listFiles: async (glob, requestedWorkstreamId) =>
			invoke('extensions.list-workstream-files', {
				extensionId: input.extensionId,
				workstreamId: workstreamId(requestedWorkstreamId),
				...(glob ? { glob } : {}),
			}),
		readFile: async (path, requestedWorkstreamId) =>
			invoke('extensions.read-workstream-file', {
				extensionId: input.extensionId,
				workstreamId: workstreamId(requestedWorkstreamId),
				path,
			}),
		readRepositoryFile: async (path, requestedWorkstreamId) =>
			invoke('extensions.read-repository-file', {
				extensionId: input.extensionId,
				workstreamId: workstreamId(requestedWorkstreamId),
				path,
			}),
		writeFile: async (path, contents, requestedWorkstreamId) =>
			invoke('extensions.write-workstream-file', {
				extensionId: input.extensionId,
				workstreamId: workstreamId(requestedWorkstreamId),
				path,
				contents,
			}),
		stat: async (path, requestedWorkstreamId) =>
			invoke('extensions.stat-workstream-file', {
				extensionId: input.extensionId,
				workstreamId: workstreamId(requestedWorkstreamId),
				path,
			}),
	};
}
