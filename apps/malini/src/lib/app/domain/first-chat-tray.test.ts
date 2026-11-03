import { describe, expect, it } from 'vitest';
import type { GithubRepository } from '$shared/repositories/domain/repository';
import { firstChatTray } from './first-chat-tray';

function repository(fullName: string): GithubRepository {
	return { fullName, description: null, cloneUrl: '', private: false, pushedAt: null };
}

const REPOSITORIES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => repository(`me/${name}`));

function tray(picked: readonly string[]): readonly string[] {
	return firstChatTray(REPOSITORIES, (candidate) => picked.includes(candidate.fullName)).map(
		(repository) => repository.fullName,
	);
}

describe('the first chat tray', () => {
	it('shows the five newest pushes', () => {
		expect(tray([])).toEqual(['me/a', 'me/b', 'me/c', 'me/d', 'me/e']);
	});

	it('puts a repository picked further down on top, and keeps five rows', () => {
		expect(tray(['me/g', 'me/b'])).toEqual(['me/g', 'me/a', 'me/b', 'me/c', 'me/d']);
	});
});
