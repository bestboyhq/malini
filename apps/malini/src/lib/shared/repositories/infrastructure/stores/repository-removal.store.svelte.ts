class RepositoryRemovalStore {
	removing: ReadonlySet<string> = $state(new Set());

	start(repositoryId: string): boolean {
		if (this.removing.has(repositoryId)) return false;
		this.removing = new Set([...this.removing, repositoryId]);
		return true;
	}

	finish(repositoryId: string): void {
		this.removing = new Set([...this.removing].filter((id) => id !== repositoryId));
	}
}

export const repositoryRemovalStore = new RepositoryRemovalStore();
