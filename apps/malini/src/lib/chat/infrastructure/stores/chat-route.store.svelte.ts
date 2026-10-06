import { navigationTargetsWorkstream } from '$shared/router/navigation-target';
import { navigating, page } from '$shared/router/state';

class ChatRouteStore {
	readonly workstreamId: string = $derived(page.params.workstreamId ?? '');
	readonly requestedSessionId: string | null = $derived(page.url.searchParams.get('agent'));

	stillTargets(workstreamId: string): boolean {
		return navigationTargetsWorkstream(navigating.to, workstreamId);
	}

	isCurrentWorkstream(workstreamId: string): boolean {
		return this.workstreamId === workstreamId && this.stillTargets(workstreamId);
	}

	hasSessionParam(): boolean {
		return page.url.searchParams.has('agent');
	}

	readSessionParam(): string | null {
		return page.url.searchParams.get('agent');
	}

	hrefWithSession(sessionId: string): string {
		const next = new URL(page.url);
		next.searchParams.set('agent', sessionId);
		return `${next.pathname}${next.search}`;
	}

	hrefWithoutSession(): string {
		const next = new URL(page.url);
		next.searchParams.delete('agent');
		return `${next.pathname}${next.search}`;
	}
}

export const chatRoute = new ChatRouteStore();
