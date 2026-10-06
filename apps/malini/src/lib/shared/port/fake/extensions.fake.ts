import type { ExtensionFileStat } from '$contract/system';
import type { FakeBridge } from './fake-bridge';
import type { FakeState } from './state';

export function installExtensionsFake(bridge: FakeBridge, state: FakeState): void {
	bridge.define('extensions.list-workstream-files', async (input) => {
		assertFakeExtensionFileOwner(state, input.extensionId, input.workstreamId);
		const files = Object.keys(state.extensionWorkstreamFiles[input.workstreamId] ?? {});
		return files.filter((path) => !input.glob || matchesFakeGlob(path, input.glob)).sort();
	});

	bridge.define('extensions.read-workstream-file', async (input) => {
		assertFakeExtensionFileOwner(state, input.extensionId, input.workstreamId);
		const path = fakeExtensionRelativePath(input.path, false);
		const files = state.extensionWorkstreamFiles[input.workstreamId] ?? {};
		const contents = files[path];
		if (contents === undefined) {
			throw new Error(`Unknown fake extension workstream file: ${path}`);
		}
		return contents;
	});

	bridge.define('extensions.read-repository-file', async (input) => {
		assertFakeExtensionFileOwner(state, input.extensionId, input.workstreamId);
		const path = fakeExtensionRelativePath(input.path, false);
		const files = state.extensionWorkstreamFiles[input.workstreamId] ?? {};
		const contents = files[path];
		if (contents === undefined) {
			throw new Error(`Unknown fake extension repository file: ${path}`);
		}
		return contents;
	});

	bridge.define('extensions.write-workstream-file', async (input) => {
		assertFakeExtensionFileOwner(state, input.extensionId, input.workstreamId);
		const path = fakeExtensionRelativePath(input.path, false);
		const workstreamFiles = (state.extensionWorkstreamFiles[input.workstreamId] ??= {});
		workstreamFiles[path] = input.contents;
	});

	bridge.define(
		'extensions.stat-workstream-file',
		async (input): Promise<ExtensionFileStat | null> => {
			assertFakeExtensionFileOwner(state, input.extensionId, input.workstreamId);
			const path = fakeExtensionRelativePath(input.path, true);
			const files = state.extensionWorkstreamFiles[input.workstreamId] ?? {};
			if (path in files) {
				return { kind: 'file', size: new TextEncoder().encode(files[path]).byteLength };
			}
			const prefix = path ? `${path}/` : '';
			return Object.keys(files).some((file) => file.startsWith(prefix))
				? { kind: 'directory', size: 0 }
				: null;
		},
	);

	bridge.define('extensions.list-sources', async () => {
		return [...state.extensionSources, ...state.managedExtensionSources].map((source) => ({
			...source,
		}));
	});

	bridge.define('extensions.list-managed', async () => {
		return state.managedExtensionSources.map((source) => ({
			...source,
			previousVersions: [...source.previousVersions],
		}));
	});

	bridge.define('extensions.set-managed-enabled', async (input) => {
		const source = state.managedExtensionSources.find(({ id }) => id === input.extensionId);
		if (!source) throw new Error(`Managed extension ${input.extensionId} is not installed`);
		if (source.enabled !== input.enabled) {
			source.enabled = input.enabled;
			source.reloadSequence += 1;
		}
		return { ...source, previousVersions: [...source.previousVersions] };
	});

	bridge.define('extensions.rollback-managed', async (input) => {
		const history = state.managedExtensionHistory[input.extensionId] ?? [];
		const previous = history.at(-1);
		if (!previous)
			throw new Error(`Managed extension ${input.extensionId} has no rollback version`);
		state.managedExtensionHistory[input.extensionId] = history.slice(0, -1);
		const restored = {
			...previous,
			reloadSequence:
				(state.managedExtensionSources.find(({ id }) => id === input.extensionId)?.reloadSequence ??
					previous.reloadSequence) + 1,
			previousVersions: history.slice(0, -1).map(({ version }) => version),
		};
		state.managedExtensionSources = [
			...state.managedExtensionSources.filter(({ id }) => id !== input.extensionId),
			restored,
		];
		return { ...restored, previousVersions: [...restored.previousVersions] };
	});

	bridge.define('extensions.recovery-mode-enabled', async () => {
		return state.extensionRecoveryMode;
	});

	bridge.define('extensions.append-development-log', async (input) => {
		state.extensionDevelopmentLogs.push({ ...input.log });
	});
}

function assertFakeExtensionFileOwner(
	state: FakeState,
	extensionId: string,
	workstreamId: string,
): void {
	if (!extensionId.trim()) throw new Error('Fake extension filesystem requires an extension id');
	if (!state.workstreams.some((workstream) => workstream.id === workstreamId)) {
		throw new Error(`Unknown fake extension workstream: ${workstreamId}`);
	}
}

function fakeExtensionRelativePath(path: string, allowEmpty: boolean): string {
	if (path.includes('\0') || path.startsWith('/') || /^[a-z]:[\\/]/iu.test(path)) {
		throw new Error(`Fake extension workstream path must be relative: ${path}`);
	}
	const segments = path.replaceAll('\\', '/').split('/');
	const normalized: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			throw new Error(`Fake extension workstream path escapes its workstream: ${path}`);
		}
		normalized.push(segment);
	}
	if (!allowEmpty && normalized.length === 0) {
		throw new Error('Fake extension workstream path cannot be empty');
	}
	return normalized.join('/');
}

function matchesFakeGlob(path: string, glob: string): boolean {
	let expression = '^';
	for (let index = 0; index < glob.length; index += 1) {
		const character = glob[index];
		if (character === '*' && glob[index + 1] === '*') {
			index += 1;
			if (glob[index + 1] === '/') {
				index += 1;
				expression += '(?:.*/)?';
			} else {
				expression += '.*';
			}
		} else if (character === '*') {
			expression += '[^/]*';
		} else if (character === '?') {
			expression += '[^/]';
		} else {
			expression += character?.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&') ?? '';
		}
	}
	return new RegExp(`${expression}$`, 'u').test(path);
}
