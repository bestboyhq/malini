import {
	repositorySurfaceHasBeenRead,
	type RepositorySurface,
	type RepositorySurfaceLoad,
} from '$lib/pull-requests/domain/repository-surface';

class RepositorySurfaceAggregate {
	surfaceByWorkstream: Readonly<Record<string, RepositorySurface>> = $state.raw({});
	readSurfaceByWorkstream: Readonly<Record<string, RepositorySurface>> = $state.raw({});
	loadByWorkstream: Readonly<Record<string, RepositorySurfaceLoad>> = $state.raw({});
	readonly #generationByWorkstream = new Map<string, number>();

	surfaceFor(workstreamId: string): RepositorySurface | null {
		return this.surfaceByWorkstream[workstreamId] ?? null;
	}

	presentedSurfaceFor(workstreamId: string): RepositorySurface | null {
		const latest = this.surfaceFor(workstreamId);
		if (latest !== null && repositorySurfaceHasBeenRead(latest)) return latest;
		return this.readSurfaceByWorkstream[workstreamId] ?? latest;
	}

	loadFor(workstreamId: string): RepositorySurfaceLoad | null {
		return this.loadByWorkstream[workstreamId] ?? null;
	}

	accept(workstreamId: string, next: RepositorySurface): void {
		if (next.workstreamId !== workstreamId) return;
		this.surfaceByWorkstream = { ...this.surfaceByWorkstream, [workstreamId]: next };
		if (!repositorySurfaceHasBeenRead(next)) return;
		this.readSurfaceByWorkstream = { ...this.readSurfaceByWorkstream, [workstreamId]: next };
	}

	beginLoad(workstreamId: string): number {
		const generation = (this.#generationByWorkstream.get(workstreamId) ?? 0) + 1;
		this.#generationByWorkstream.set(workstreamId, generation);
		this.#markLoad(workstreamId, 'loading');
		return generation;
	}

	finishLoad(workstreamId: string, generation: number, load: 'loaded' | 'failed'): void {
		if (!this.loadIsCurrent(workstreamId, generation)) return;
		this.#markLoad(workstreamId, load);
	}

	loadIsCurrent(workstreamId: string, generation: number): boolean {
		return this.#generationByWorkstream.get(workstreamId) === generation;
	}

	forget(workstreamId: string): void {
		this.#generationByWorkstream.delete(workstreamId);
		this.surfaceByWorkstream = withoutKey(this.surfaceByWorkstream, workstreamId);
		this.readSurfaceByWorkstream = withoutKey(this.readSurfaceByWorkstream, workstreamId);
		this.loadByWorkstream = withoutKey(this.loadByWorkstream, workstreamId);
	}

	clear(): void {
		this.#generationByWorkstream.clear();
		this.surfaceByWorkstream = {};
		this.readSurfaceByWorkstream = {};
		this.loadByWorkstream = {};
	}

	#markLoad(workstreamId: string, load: RepositorySurfaceLoad): void {
		if (this.loadByWorkstream[workstreamId] === load) return;
		this.loadByWorkstream = { ...this.loadByWorkstream, [workstreamId]: load };
	}
}

function withoutKey<T>(
	values: Readonly<Record<string, T>>,
	key: string,
): Readonly<Record<string, T>> {
	if (!Object.hasOwn(values, key)) return values;
	const { [key]: _removed, ...rest } = values;
	return rest;
}

export const repositorySurfaceAggregate = new RepositorySurfaceAggregate();
