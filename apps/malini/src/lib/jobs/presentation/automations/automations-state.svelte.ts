import { RECIPES } from './recipes';

export type DraftRequest = Readonly<{ text: string; title: string | undefined; key: number }>;

class AutomationsState {
	text = $state('');
	draft = $state<DraftRequest | null>(null);
	savingSince = $state<number | null>(null);

	startDraft(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		this.text = trimmed;
		this.draft = {
			text: trimmed,
			title: RECIPES.find((recipe) => recipe.sentence === trimmed)?.title,
			key: (this.draft?.key ?? 0) + 1,
		};
		this.savingSince = null;
	}

	discardDraft(): void {
		this.draft = null;
		this.savingSince = null;
	}

	noteSaving(completed: number): void {
		this.savingSince = completed;
	}

	settle(completed: number): void {
		if (this.savingSince === null || completed <= this.savingSince) return;
		this.draft = null;
		this.text = '';
		this.savingSince = null;
	}
}

export const automationsState = new AutomationsState();

export type AutomationsView = 'overview' | 'activity' | 'recipes';
