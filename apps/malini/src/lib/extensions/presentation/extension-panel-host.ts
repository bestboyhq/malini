import {
	installExtensionPanelBaseStyles,
	type ExtensionDisposable,
	type ExtensionPanelContext,
	type ExtensionPanelInstance,
	type ExtensionPanelRegistration,
} from '@malini/extension-api';

export type ExtensionPanelHostErrorHandler = (
	cause: unknown,
	panel: ExtensionPanelRegistration | null,
) => void;

export class ExtensionPanelHostController {
	#panel: ExtensionPanelRegistration | null = null;
	#target: HTMLElement | null = null;
	#mountTarget: HTMLElement | null = null;
	#ownsMountTarget = false;
	#instance: ExtensionPanelInstance | null = null;
	#pending: Promise<void> = Promise.resolve();
	#requestRevision = 0;
	#mountAttempt: { revision: number; supersede: () => void } | null = null;
	#baseStyles: ExtensionDisposable | null = null;

	constructor(private readonly onerror: ExtensionPanelHostErrorHandler = () => undefined) {}

	render(
		target: HTMLElement,
		panel: ExtensionPanelRegistration,
		context: ExtensionPanelContext,
	): Promise<void> {
		this.#baseStyles ??= installExtensionPanelBaseStyles(target.ownerDocument ?? undefined);
		const revision = ++this.#requestRevision;
		this.#mountAttempt?.supersede();
		return this.#enqueue(async () => {
			if (revision !== this.#requestRevision) return;
			const sameMount = this.#panel === panel && this.#target === target && this.#instance !== null;
			if (sameMount) {
				try {
					await this.#instance?.update?.(context);
				} catch (cause) {
					await this.#disposeCurrent();
					this.onerror(cause, panel);
				}
				return;
			}

			await this.#disposeCurrent();
			this.#panel = panel;
			this.#target = target;
			const { target: mountTarget, owned } = createIsolatedMountTarget(target, panel.id);
			this.#mountTarget = mountTarget;
			this.#ownsMountTarget = owned;
			let supersede!: () => void;
			const superseded = new Promise<void>((resolve) => {
				supersede = resolve;
			});
			const attempt = { revision, supersede };
			this.#mountAttempt = attempt;
			try {
				const mount = Promise.resolve(panel.component.mount(mountTarget, context));
				const result = await Promise.race([
					mapPromise(mount, (instance) => ({ kind: 'mounted' as const, instance })),
					mapPromise(superseded, () => ({ kind: 'superseded' as const })),
				]);
				if (this.#mountAttempt === attempt) this.#mountAttempt = null;
				if (result.kind === 'superseded') {
					this.#clearCurrentMount(mountTarget);
					void (async () => {
						try {
							const instance = await mount;
							await this.#disposeRetired(instance, mountTarget, owned, panel);
						} catch {
							removeOwnedMountTarget(mountTarget, owned);
						}
					})();
					return;
				}
				this.#instance = result.instance;
			} catch (cause) {
				if (this.#mountAttempt === attempt) this.#mountAttempt = null;
				this.#clearCurrentMount(mountTarget);
				this.onerror(cause, panel);
			}
		});
	}

	dispose(): Promise<void> {
		this.#requestRevision += 1;
		this.#mountAttempt?.supersede();
		const baseStyles = this.#baseStyles;
		this.#baseStyles = null;
		return this.#enqueue(async () => {
			await this.#disposeCurrent();
			await baseStyles?.dispose();
		});
	}

	isMounted(target: HTMLElement, panel: ExtensionPanelRegistration): boolean {
		return this.#target === target && this.#panel === panel && this.#instance !== null;
	}

	whenIdle(): Promise<void> {
		return this.#pending;
	}

	#enqueue(operation: () => void | Promise<void>): Promise<void> {
		const prior = this.#pending;
		this.#pending = (async () => {
			await settled(prior);
			try {
				await operation();
			} catch (cause) {
				this.onerror(cause, this.#panel);
			}
		})();
		return this.#pending;
	}

	async #disposeCurrent(): Promise<void> {
		const instance = this.#instance;
		const mountTarget = this.#mountTarget;
		const ownsMountTarget = this.#ownsMountTarget;
		this.#instance = null;
		this.#panel = null;
		this.#target = null;
		this.#mountTarget = null;
		this.#ownsMountTarget = false;
		try {
			if (instance) await instance.dispose();
		} finally {
			if (mountTarget) removeOwnedMountTarget(mountTarget, ownsMountTarget);
		}
	}

	#clearCurrentMount(owner: HTMLElement): void {
		if (this.#mountTarget !== owner) return;
		const mountTarget = this.#mountTarget;
		const ownsMountTarget = this.#ownsMountTarget;
		this.#instance = null;
		this.#panel = null;
		this.#target = null;
		this.#mountTarget = null;
		this.#ownsMountTarget = false;
		if (mountTarget) removeOwnedMountTarget(mountTarget, ownsMountTarget);
	}

	async #disposeRetired(
		instance: ExtensionPanelInstance,
		mountTarget: HTMLElement,
		owned: boolean,
		panel: ExtensionPanelRegistration,
	): Promise<void> {
		try {
			await instance.dispose();
		} catch (cause) {
			this.onerror(cause, panel);
		} finally {
			removeOwnedMountTarget(mountTarget, owned);
		}
	}
}

function createIsolatedMountTarget(
	target: HTMLElement,
	panelId: string,
): { target: HTMLElement; owned: boolean } {
	const document = target.ownerDocument;
	if (
		!document ||
		typeof document.createElement !== 'function' ||
		typeof target.append !== 'function'
	) {
		return { target, owned: false };
	}
	const mountTarget = document.createElement('div');
	mountTarget.className = 'extension-panel-mount h-full min-h-0 w-full min-w-0 overflow-hidden';
	mountTarget.dataset.extensionPanelMount = '';
	mountTarget.dataset.panelId = panelId;
	target.append(mountTarget);
	return { target: mountTarget, owned: true };
}

function removeOwnedMountTarget(target: HTMLElement, owned: boolean): void {
	if (owned) target.remove();
}

async function mapPromise<T, R>(promise: Promise<T>, map: (value: T) => R): Promise<R> {
	return map(await promise);
}

async function settled(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch {
		return;
	}
}
