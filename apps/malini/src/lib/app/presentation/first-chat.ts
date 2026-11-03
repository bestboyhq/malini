import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
import { composerPendingSubmissionsQuery } from '$lib/chat/application/queries/composer-pending-submissions.query.svelte';
import { workstreamChatsQuery } from '$lib/chat/application/queries/workstream-chats.query.svelte';
import { connectedRepositoriesQuery } from '$shared/repositories/repositories.api';
import { page } from '$shared/router/state';

export function firstChatWaits(workstreamId: string): boolean {
	return (
		workstreamId !== '' &&
		workstreamId === onboardingQuery.data.firstChatId &&
		!page.url.searchParams.has('agent') &&
		!firstChatBegan()
	);
}

export function firstChatBare(workstreamId: string): boolean {
	return firstChatWaits(workstreamId) && connectedRepositoriesQuery.data.length === 0;
}

export function firstChatBegan(): boolean {
	const { firstChatId } = onboardingQuery.data;
	return (
		firstChatId !== null &&
		(composerPendingSubmissionsQuery.data > 0 || workstreamChatsQuery.data(firstChatId).length > 0)
	);
}
