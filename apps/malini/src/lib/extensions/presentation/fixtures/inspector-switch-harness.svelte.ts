import type {
	ExtensionPanelContext,
	ExtensionPanelRegistration,
	ExtensionWorkstream,
} from '@malini/extension-api';

export class InspectorSwitchProps {
	workstreamId = $state('workstream-a');
	ready = $state(true);
	panels = $state.raw<readonly ExtensionPanelRegistration[]>([]);
	readonly #contexts = new Map<string, ExtensionPanelContext>();

	get context(): ExtensionPanelContext {
		const existing = this.#contexts.get(this.workstreamId);
		if (existing) return existing;
		const created: ExtensionPanelContext = {
			workstream: switchWorkstream(this.workstreamId),
			settings: {},
			executeCommand: () => Promise.reject(new Error('No extension host in this harness')),
		};
		this.#contexts.set(this.workstreamId, created);
		return created;
	}
}

export class RuntimeWorkstream {
	#workstreamId = 'workstream-a';
	readonly #listeners = new Set<(workstreamId: string) => void>();

	get workstreamId(): string {
		return this.#workstreamId;
	}

	switchTo(workstreamId: string): void {
		this.#workstreamId = workstreamId;
		for (const listener of this.#listeners) listener(workstreamId);
	}

	subscribe(listener: (workstreamId: string) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

export function contextBoundPanel(id: string, mounts: string[]): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: `${id}-icon`,
		component: {
			workstreamScope: 'context',
			mount: (target, context) => {
				const node = target.ownerDocument.createElement('p');
				const show = (next: ExtensionPanelContext): void => {
					node.textContent = `Files of ${next.workstream?.id ?? 'no workstream'}`;
				};
				mounts.push(context.workstream?.id ?? 'no workstream');
				show(context);
				target.append(node);
				return { update: show, dispose: () => node.remove() };
			},
		},
	};
}

export function runtimeBoundPanel(
	id: string,
	runtime: RuntimeWorkstream,
): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: `${id}-icon`,
		component: {
			mount: (target) => {
				const node = target.ownerDocument.createElement('p');
				const show = (workstreamId: string): void => {
					node.textContent = `Terminal of ${workstreamId}`;
				};
				show(runtime.workstreamId);
				const stop = runtime.subscribe(show);
				target.append(node);
				return {
					dispose: () => {
						stop();
						node.remove();
					},
				};
			},
		},
	};
}

function switchWorkstream(id: string): ExtensionWorkstream {
	return { id, path: `/tmp/${id}`, repositoryPath: `/tmp/${id}`, branch: id, baseBranch: 'main' };
}
