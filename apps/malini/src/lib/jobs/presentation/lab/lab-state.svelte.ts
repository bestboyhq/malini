import type { JobDefinitionRecord } from '$contract/jobs';
import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_RUN_PROFILE } from '$shared/providers/providers.api';
import { LAB_RECIPES, type LabSavedDraft } from './lab-recipes';
import { labDefaultSetup, type LabJobSetup } from './lab-triggers';

export type LabSection = 'overview' | 'activity' | 'recipes';

export type LabDraftRequest = Readonly<{ text: string; title: string | undefined; key: number }>;

export const LAB_LOCAL_JOB_PREFIX = 'lab-draft-';

class LabState {
	section = $state<LabSection>('overview');
	selectedJobId = $state<string | null>(null);
	created = $state<readonly JobDefinitionRecord[]>([]);
	dismissed = $state<readonly string[]>([]);
	text = $state('');
	draft = $state<LabDraftRequest | null>(null);
	#setups = $state<Record<string, LabJobSetup>>({});

	setupOf = (definition: JobDefinitionRecord): LabJobSetup =>
		this.#setups[definition.id] ?? labDefaultSetup(definition);

	setSetup = (definition: JobDefinitionRecord, setup: LabJobSetup): void => {
		this.#setups[definition.id] = setup;
	};

	startDraft(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		this.text = trimmed;
		this.draft = {
			text: trimmed,
			title: LAB_RECIPES.find((recipe) => recipe.sentence === trimmed)?.title,
			key: (this.draft?.key ?? 0) + 1,
		};
		this.section = 'overview';
	}

	saveDraft(draft: LabSavedDraft): void {
		const now = new Date().toISOString();
		const record: JobDefinitionRecord = {
			id: `${LAB_LOCAL_JOB_PREFIX}${this.created.length + 1}`,
			name: draft.name,
			instructions: draft.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
			model: DEFAULT_AGENT_MODEL,
			effort: DEFAULT_AGENT_RUN_PROFILE.effort,
			runsIn: draft.setup.runsIn ?? 'workstream',
			output: draft.setup.output ?? 'none',
			skills: [],
			builtin: null,
			createdAt: now,
			updatedAt: now,
		};
		this.created = [record, ...this.created];
		this.setSetup(record, draft.setup);
		this.draft = null;
		this.text = '';
	}
}

export const labState = new LabState();
