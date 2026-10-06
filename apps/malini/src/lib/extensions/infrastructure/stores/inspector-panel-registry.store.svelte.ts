import type { ExtensionDisposable, ExtensionPanelRegistration } from '@malini/extension-api';

export class InspectorPanelRegistry {
	#registered = $state<ExtensionPanelRegistration[]>([]);
	readonly #registrations = new Map<string, symbol>();

	get panels(): readonly ExtensionPanelRegistration[] {
		return this.#registered.filter((panel) => panel.instances !== true);
	}

	documentTemplate(templateId: string): ExtensionPanelRegistration | null {
		return (
			this.#registered.find((panel) => panel.id === templateId && panel.instances === true) ?? null
		);
	}

	register(panel: ExtensionPanelRegistration): ExtensionDisposable {
		if (this.#registrations.has(panel.id)) {
			throw new Error(`Inspector panel ${panel.id} is already registered`);
		}
		const registration = Symbol(panel.id);
		this.#registrations.set(panel.id, registration);
		this.#registered = [...this.#registered, panel];
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.#registrations.get(panel.id) !== registration) return;
				this.#registrations.delete(panel.id);
				this.#registered = this.#registered.filter((candidate) => candidate.id !== panel.id);
			},
		};
	}

	clear(): void {
		this.#registrations.clear();
		this.#registered = [];
	}
}
