import type { SkillRecord } from '$contract/skills';
import type { SkillCatalog } from '$lib/skills/domain/skill-catalog';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

const EMPTY: SkillCatalog = { skills: [], state: 'idle', error: null };

class SkillCatalogAggregate {
	catalogs = $state.raw<ReadonlyMap<string, SkillCatalog>>(new Map());

	#generations = new Map<string, number>();

	catalog(workstreamId: string | null): SkillCatalog {
		return this.catalogs.get(scopeKey(workstreamId)) ?? EMPTY;
	}

	async load(workstreamId: string | null): Promise<void> {
		const key = scopeKey(workstreamId);
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		const known = this.catalogs.get(key);
		if (known?.state !== 'ready') this.#set(key, { ...(known ?? EMPTY), state: 'loading' });
		try {
			const skills: readonly SkillRecord[] = await skillsService.list(workstreamId);
			if (this.#generations.get(key) !== generation) return;
			this.#set(key, { skills, state: 'ready', error: null });
		} catch (error) {
			if (this.#generations.get(key) !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			this.#set(key, { ...(this.catalogs.get(key) ?? EMPTY), state: 'error', error: message });
		}
	}

	#set(key: string, catalog: SkillCatalog): void {
		const next = new Map(this.catalogs);
		next.set(key, catalog);
		this.catalogs = next;
	}
}

function scopeKey(workstreamId: string | null): string {
	return workstreamId ?? '';
}

export const skillCatalogAggregate = new SkillCatalogAggregate();
