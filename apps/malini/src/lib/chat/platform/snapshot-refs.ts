import { runGit } from '$main/git/run';
import { LEGACY_SNAPSHOT_REF_ROOTS, SNAPSHOT_REF_ROOT } from '$main/git/snapshots';

export async function adoptSnapshotRefNamespace(worktreePath: string): Promise<void> {
	try {
		await migrateSnapshotRefs(worktreePath);
	} catch (error) {
		console.error(
			`malini: could not adopt the \`${SNAPSHOT_REF_ROOT}\` namespace in \`${worktreePath}\`: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export class SnapshotRefNamespace {
	private readonly adopted = new Map<string, Promise<void>>();

	adopt(worktreePath: string): Promise<void> {
		const existing = this.adopted.get(worktreePath);
		if (existing) return existing;
		const started = adoptSnapshotRefNamespace(worktreePath);
		this.adopted.set(worktreePath, started);
		return started;
	}
}

async function migrateSnapshotRefs(worktreePath: string): Promise<void> {
	const listing = await runGit([
		'-C',
		worktreePath,
		'for-each-ref',
		'--format=%(refname) %(objectname)',
		...LEGACY_SNAPSHOT_REF_ROOTS,
	]);
	for (const line of listing.split('\n')) {
		const separator = line.indexOf(' ');
		if (separator <= 0) continue;
		const legacyRef = line.slice(0, separator);
		const objectName = line.slice(separator + 1).trim();
		const legacyRoot = LEGACY_SNAPSHOT_REF_ROOTS.find((root) => legacyRef.startsWith(root));
		if (!legacyRoot || objectName.length === 0) continue;
		const adoptedRef = `${SNAPSHOT_REF_ROOT}${legacyRef.slice(legacyRoot.length)}`;
		await runGit(['-C', worktreePath, 'update-ref', adoptedRef, objectName]);
		await runGit(['-C', worktreePath, 'update-ref', '-d', legacyRef, objectName]);
	}
}
