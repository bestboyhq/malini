import { getContext, setContext } from 'svelte';
import type { IconName } from '$hyper-ui/icons';

export type GlobalTopBarAction = Readonly<{
	id: string;
	label: string;
	ariaLabel: string;
	tooltip: string;
	scope?: GlobalTopBarActionScope;
	disabled?: boolean;
	busy?: boolean;
	tone?: 'primary' | 'secondary';
	icon?: IconName | null;
	testId?: string;
	onInvoke(): void | Promise<void>;
}>;

export type GlobalTopBarActionScope = Readonly<{
	pathPrefix: string;
	minimumSegments?: number;
}>;

export function globalTopBarActionMatchesPathname(
	action: GlobalTopBarAction,
	pathname: string,
): boolean {
	const rawPrefix = action.scope?.pathPrefix;
	if (!rawPrefix) return true;

	const prefix = normalizePath(rawPrefix);
	const path = normalizePath(pathname);
	const insidePrefix = path === prefix || path.startsWith(`${prefix}/`);
	if (!insidePrefix) return false;

	const segmentCount = path.split('/').filter(Boolean).length;
	return segmentCount >= (action.scope?.minimumSegments ?? 0);
}

function normalizePath(value: string): string {
	const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
	return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/u, '') : '/';
}

export type GlobalTopBarActionRegistration = Readonly<{
	update(action: GlobalTopBarAction | null): void;
	dispose(): void;
}>;

type OwnedAction = Readonly<{
	token: symbol;
	action: GlobalTopBarAction;
}>;

export class GlobalTopBarActionRegistry {
	actions = $state<readonly GlobalTopBarAction[]>([]);
	readonly #owned = new Map<string, OwnedAction>();

	register(owner: string): GlobalTopBarActionRegistration {
		const token = Symbol(owner);
		let disposed = false;
		return {
			update: (action) => {
				if (disposed) return;
				if (!action) {
					if (this.#owned.get(owner)?.token === token) {
						this.#owned.delete(owner);
						this.#publish();
					}
					return;
				}
				this.#owned.set(owner, { token, action });
				this.#publish();
			},
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.#owned.get(owner)?.token !== token) return;
				this.#owned.delete(owner);
				this.#publish();
			},
		};
	}

	#publish(): void {
		this.actions = [...this.#owned.values()].map(({ action }) => action);
	}
}

export type GlobalTopBarStatusTone =
	'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'merged';

export type GlobalTopBarStatusCheck = Readonly<{
	id: string;
	name: string;
	detail: string;
	tone: GlobalTopBarStatusTone;
	blocking: boolean;
}>;

export type GlobalTopBarStatusNote = Readonly<{
	label: string;
	tone: GlobalTopBarStatusTone;
}>;

export type GlobalTopBarStatusHeadline = GlobalTopBarStatusNote &
	Readonly<{
		detail: string | null;
	}>;

export type GlobalTopBarStatusAction = Readonly<{
	label: string;
	ariaLabel: string;
	tooltip: string;
	tone: 'primary' | 'secondary';
	icon?: IconName | null;
	disabled: boolean;
	busy: boolean;
	onInvoke(): void | Promise<void>;
}>;

export type GlobalTopBarStatusDetailAction = Readonly<{
	id: string;
	label: string;
	disabled?: boolean;
	confirmLabel?: string | null;
	onInvoke(): void | Promise<void>;
}>;

export type GlobalTopBarGithubStatus = Readonly<{
	reference: string | null;
	title: string | null;
	branch: string | null;
	url?: string | null;
	checks: readonly GlobalTopBarStatusCheck[];
	checksSummary: string;
	review: GlobalTopBarStatusNote | null;
	todos: GlobalTopBarStatusNote | null;
	changes?: GlobalTopBarStatusNote | null;
	headline?: GlobalTopBarStatusHeadline | null;
	secondaryAction?: GlobalTopBarStatusAction | null;
	action: GlobalTopBarStatusAction | null;
	detailActions?: readonly GlobalTopBarStatusDetailAction[];
	remoteFailure?: string | null;
	placeholder?: string | null;
}>;

class GlobalTopBarGithubStatusStore {
	current = $state<GlobalTopBarGithubStatus | null>(null);
	#owner: string | null = null;

	publish(owner: string, status: GlobalTopBarGithubStatus | null): void {
		this.#owner = owner;
		this.current = status;
	}

	clear(owner: string): void {
		if (this.#owner !== owner) return;
		this.#owner = null;
		this.current = null;
	}

	get owner(): string | null {
		return this.#owner;
	}
}

export const globalTopBarGithubStatus = new GlobalTopBarGithubStatusStore();

class GlobalTopBarBandSlot {
	host = $state.raw<HTMLElement | null>(null);
	adopted = $state.raw(false);
}

export const globalTopBarBandSlot = new GlobalTopBarBandSlot();

export function globalTopBarBandSlotHost(node: HTMLElement): { destroy(): void } {
	if (typeof document === 'undefined' || document.documentElement.dataset.nativeShell !== 'true') {
		return { destroy: () => undefined };
	}

	globalTopBarBandSlot.host = node;

	return {
		destroy(): void {
			if (globalTopBarBandSlot.host === node) globalTopBarBandSlot.host = null;
		},
	};
}

const GLOBAL_TOPBAR_ACTIONS = Symbol.for('malini.global-topbar-actions');

export function provideGlobalTopBarActions(): GlobalTopBarActionRegistry {
	const registry = new GlobalTopBarActionRegistry();
	setContext(GLOBAL_TOPBAR_ACTIONS, registry);
	return registry;
}

export function useGlobalTopBarActions(): GlobalTopBarActionRegistry | null {
	return getContext<GlobalTopBarActionRegistry | undefined>(GLOBAL_TOPBAR_ACTIONS) ?? null;
}
