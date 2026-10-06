import { SKIPPED_DIRECTORIES } from '$main/fs/paths';
import { recordedRemoteBase } from '$main/git/remote';
import { runGit } from '$main/git/run';

export async function listBaseFiles(repoPath: string, baseBranch: string): Promise<string[]> {
	const ref = await recordedRemoteBase(repoPath, baseBranch);
	if (!ref) return [];
	const output = await runGit(['-C', repoPath, 'ls-tree', '-r', '-z', '--full-tree', ref]);
	return output
		.split('\0')
		.flatMap((entry) => {
			const tab = entry.indexOf('\t');
			if (tab < 0) return [];
			const [, type] = entry.slice(0, tab).split(' ');
			const path = entry.slice(tab + 1);
			if (type !== 'blob' || path.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment))) {
				return [];
			}
			return [path];
		})
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
