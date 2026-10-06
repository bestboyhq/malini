import type { Project } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { captureRendererError } from '$shared/errors/renderer-error-sink';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export class WorkstreamsAggregate {
	workstreams = $state<Workstream[]>([]);
	projects = $state<Project[]>([]);
	loading = $state(false);
	loaded = $state(false);
	lastError = $state<string | null>(null);

	private refreshGeneration = 0;
	private pending: Workstream[] = [];
	private retiring = new Set<string>();

	async refresh(): Promise<void> {
		const generation = ++this.refreshGeneration;
		this.loading = true;
		try {
			const [workstreams, projects] = await Promise.all([
				workstreamsService.listWorkstreams(),
				workstreamsService.listProjects(),
			]);
			if (generation !== this.refreshGeneration) return;
			this.workstreams = this.withPending(workstreams);
			this.projects = [...projects];
			this.lastError = null;
		} catch (err) {
			captureRendererError('caught', err);
			if (generation !== this.refreshGeneration) return;
			this.lastError = err instanceof Error ? err.message : String(err);
		} finally {
			if (generation === this.refreshGeneration) {
				this.loading = false;
				this.loaded = true;
			}
		}
	}

	upsert(workstream: Workstream): void {
		this.mutate((workstreams) => [
			workstream,
			...workstreams.filter((existing) => existing.id !== workstream.id),
		]);
	}

	remove(workstreamId: string): void {
		this.mutate((workstreams) => workstreams.filter((entry) => entry.id !== workstreamId));
	}

	rename(workstreamId: string, name: string): void {
		this.mutate((workstreams) =>
			workstreams.map((entry) => (entry.id === workstreamId ? { ...entry, name } : entry)),
		);
	}

	stagePendingWorkstream(workstream: Workstream): void {
		this.pending = [workstream, ...this.pending.filter((entry) => entry.id !== workstream.id)];
		this.upsert(workstream);
	}

	settlePendingWorkstream(workstream: Workstream): void {
		this.forgetPendingWorkstream(workstream.id);
		this.upsert(workstream);
	}

	discardPendingWorkstream(workstreamId: string): void {
		this.forgetPendingWorkstream(workstreamId);
		this.remove(workstreamId);
	}

	pendingWorkstreams(): readonly Workstream[] {
		return this.pending;
	}

	retireWorkstreamOptimistically(workstreamId: string): Workstream | null {
		const retired = this.workstreams.find((entry) => entry.id === workstreamId) ?? null;
		if (!retired) return null;
		this.retiring.add(workstreamId);
		this.mutate((workstreams) => [...workstreams]);
		return retired;
	}

	restoreRetiredWorkstream(workstream: Workstream): void {
		this.forgetRetiredWorkstream(workstream.id);
		this.upsert(workstream);
	}

	forgetRetiredWorkstream(workstreamId: string): void {
		this.retiring.delete(workstreamId);
	}

	reset(): void {
		this.refreshGeneration += 1;
		this.workstreams = [];
		this.projects = [];
		this.loading = false;
		this.loaded = false;
		this.lastError = null;
		this.pending = [];
		this.retiring.clear();
	}

	private forgetPendingWorkstream(workstreamId: string): void {
		this.pending = this.pending.filter((entry) => entry.id !== workstreamId);
	}

	private withPending(workstreams: readonly Workstream[]): Workstream[] {
		const visible = this.retiring.size
			? workstreams.filter((entry) => !this.retiring.has(entry.id))
			: workstreams;
		if (this.pending.length === 0) return [...visible];
		const known = new Set(visible.map((entry) => entry.id));
		return [...this.pending.filter((entry) => !known.has(entry.id)), ...visible];
	}

	private mutate(mutation: (workstreams: readonly Workstream[]) => Workstream[]): void {
		this.workstreams = this.withPending(mutation(this.workstreams));
	}
}

export const workstreamsAggregate = new WorkstreamsAggregate();
