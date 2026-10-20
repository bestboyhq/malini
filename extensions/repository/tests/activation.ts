import type { ExtensionModule } from '@malini/extension-api';
import type { ExtensionTestHost } from '@malini/extension-api/test';
import type { RepositoryViewState } from '../src/controller.js';
import { REPOSITORY_STATE_CHANGED_EVENT, type RepositorySurfaceState } from '../src/index.js';

type PublishedSurface = Readonly<{
	promise: Promise<RepositorySurfaceState>;
	dispose(): void;
}>;

export async function activateThroughPullRequestRead(
	host: ExtensionTestHost,
	extension: ExtensionModule,
): Promise<void> {
	await host.activate(extension);
	const published = publishedSurface(host, ({ pullRequestRefreshStatus }) =>
		pullRequestReadSettled(pullRequestRefreshStatus),
	);
	const state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
	if (pullRequestReadSettled(state.pullRequestRefreshStatus)) {
		published.dispose();
		return;
	}
	await published.promise;
}

export function publishedSurface(
	host: ExtensionTestHost,
	matches: (surface: RepositorySurfaceState) => boolean,
): PublishedSurface {
	let resolvePublished!: (surface: RepositorySurfaceState) => void;
	const promise = new Promise<RepositorySurfaceState>((resolve) => {
		resolvePublished = resolve;
	});
	const subscription = host.api.events.on<RepositorySurfaceState>(
		REPOSITORY_STATE_CHANGED_EVENT,
		(surface) => {
			if (!matches(surface)) return;
			void subscription.dispose();
			resolvePublished(surface);
		},
	);
	return { promise, dispose: () => void subscription.dispose() };
}

function pullRequestReadSettled(status: RepositoryViewState['pullRequestRefreshStatus']): boolean {
	return status === 'ready' || status === 'error';
}
