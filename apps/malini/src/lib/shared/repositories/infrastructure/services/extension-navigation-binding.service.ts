import type {
	ExtensionWorkstreamEnsureInput,
	ExtensionWorkstreamNavigationInput,
	ExtensionWorkstreamSummary,
} from '@malini/extension-api';
import type { ExtensionNavigationBinding } from '$shared/extensions/bindings';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import {
	extensionWorkstreamSummary,
	listExtensionWorkstreamsForAnchor,
	optionalExtensionText,
	requireExtensionWorkstreamForAnchor,
	requiredExtensionText,
} from '$shared/repositories/domain/extension-workstream-scope';
import { nextWorkstreamId } from '$shared/repositories/domain/project-identity';
import { workstreamFromCreated } from '$shared/repositories/domain/workstream';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { extensionWorkstreamReservationsStorage } from './extension-workstream-reservations.storage';
import { workstreamsService } from './workstreams.service';

class ExtensionNavigationBindingService implements ExtensionNavigationBinding {
	async listWorkstreams(): Promise<readonly ExtensionWorkstreamSummary[]> {
		requireLoadedWorkstreams();
		return listExtensionWorkstreamsForAnchor(
			page.params.workstreamId,
			workstreamsAggregate.workstreams,
		);
	}

	async ensureWorkstream(
		input: ExtensionWorkstreamEnsureInput,
	): Promise<ExtensionWorkstreamSummary> {
		const anchorWorkstreamId = page.params.workstreamId;
		if (!anchorWorkstreamId) {
			throw new Error('Create an extension workstream from an active workstream');
		}
		requireLoadedWorkstreams();
		const anchorId = requiredExtensionText(anchorWorkstreamId, 'Active workstream id');
		const anchor = workstreamsAggregate.workstreams.find(
			({ id, status }) => id === anchorId && status !== 'archived',
		);
		if (!anchor) throw new Error('The active workstream is no longer available');
		const project = workstreamsAggregate.projects.find(({ id }) => id === anchor.projectId);
		if (!project) throw new Error('The active workstream repository is not available');

		const name = requiredExtensionText(input.name, 'Workstream name');
		const task = requiredExtensionText(input.task, 'Workstream task');
		const provider = requiredExtensionText(input.source?.provider, 'Source provider');
		const resourceId = requiredExtensionText(input.source?.resourceId, 'Source resource id');
		const reservationKey = JSON.stringify([project.id, provider, resourceId]);
		const reservations = extensionWorkstreamReservationsStorage.read();
		let workstreamId: string | null = reservations[reservationKey] ?? null;
		const reserved = workstreamId
			? workstreamsAggregate.workstreams.find(
					({ id, projectId, status }) =>
						id === workstreamId && projectId === project.id && status !== 'archived',
				)
			: null;
		if (reserved) {
			workstreamsAggregate.upsert(reserved);
			return extensionWorkstreamSummary(reserved);
		}
		if (
			workstreamId &&
			workstreamsAggregate.workstreams.some(
				({ id, status }) => id === workstreamId && status === 'archived',
			)
		) {
			workstreamId = null;
		}
		if (!workstreamId) {
			workstreamId = nextWorkstreamId();
			extensionWorkstreamReservationsStorage.write({
				...reservations,
				[reservationKey]: workstreamId,
			});
		}
		const created = await workstreamsService.createWorkstream({
			projectId: project.id,
			projectRepoPath: project.repoPath,
			workstreamId,
			name,
			baseBranch: anchor.baseBranch || project.defaultBranch,
			creationContext: {
				task,
				source: {
					provider,
					resourceId,
					...optionalExtensionText('title', input.source.title),
					...optionalExtensionText('url', input.source.url),
				},
			},
		});
		const workstream = workstreamFromCreated(created);
		workstreamsAggregate.upsert(workstream);
		return extensionWorkstreamSummary(workstream);
	}

	async openWorkstream({ workstreamId }: ExtensionWorkstreamNavigationInput): Promise<void> {
		requireLoadedWorkstreams();
		requireExtensionWorkstreamForAnchor(
			workstreamId,
			page.params.workstreamId,
			workstreamsAggregate.workstreams,
		);
		await goto(workstreamHref(workstreamId));
	}
}

export const extensionNavigationBindingService = new ExtensionNavigationBindingService();

function requireLoadedWorkstreams(): void {
	if (!workstreamsAggregate.loaded) {
		throw new Error('Workstreams are still loading');
	}
}
