import type { GithubRepository } from '$shared/repositories/domain/repository';

export const FIRST_CHAT_TRAY_ROWS = 5;

export function firstChatTray(
	repositories: readonly GithubRepository[],
	picked: (repository: GithubRepository) => boolean,
): readonly GithubRepository[] {
	const pickedFurtherDown = repositories.slice(FIRST_CHAT_TRAY_ROWS).filter(picked);
	return [...pickedFurtherDown, ...repositories.slice(0, FIRST_CHAT_TRAY_ROWS)].slice(
		0,
		FIRST_CHAT_TRAY_ROWS,
	);
}
