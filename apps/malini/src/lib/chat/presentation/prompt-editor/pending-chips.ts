import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createPendingChip } from './prompt-chip-node';

export type PendingChip = Readonly<{ key: string; pos: number; labels: readonly string[] }>;

type PendingChipChange =
	| Readonly<{ kind: 'add'; chip: PendingChip }>
	| Readonly<{ kind: 'land'; key: string; to: number }>
	| Readonly<{ kind: 'drop'; keys: readonly string[] }>;

const pendingChipsKey = new PluginKey<readonly PendingChip[]>('pendingChips');

export const PendingChips = Extension.create({
	name: 'pendingChips',

	addProseMirrorPlugins() {
		return [
			new Plugin<readonly PendingChip[]>({
				key: pendingChipsKey,
				state: {
					init: () => [],
					apply: (transaction, chips) => {
						const mapped = transaction.docChanged
							? chips.map((chip) => ({ ...chip, pos: transaction.mapping.map(chip.pos, -1) }))
							: chips;
						const change: unknown = transaction.getMeta(pendingChipsKey);
						return isPendingChipChange(change) ? applyChange(mapped, change) : mapped;
					},
				},
				props: {
					attributes: (state): Record<string, string> =>
						pendingChipsOf(state).length > 0 ? { 'data-pending-chips': '' } : {},
					decorations: (state) => {
						const chips = pendingChipsOf(state);
						if (chips.length === 0) return DecorationSet.empty;
						return DecorationSet.create(
							state.doc,
							chips.flatMap((chip) =>
								chip.labels.map((label, index) =>
									Decoration.widget(chip.pos, () => createPendingChip(label), {
										key: `${chip.key}:${index}`,
										side: -1,
										ignoreSelection: true,
									}),
								),
							),
						);
					},
				},
			}),
		];
	},
});

export function pendingChipsOf(state: EditorState): readonly PendingChip[] {
	return pendingChipsKey.getState(state) ?? [];
}

export function addPendingChip(transaction: Transaction, chip: PendingChip): Transaction {
	return transaction.setMeta(pendingChipsKey, { kind: 'add', chip } satisfies PendingChipChange);
}

export function landPendingChip(transaction: Transaction, key: string, to: number): Transaction {
	return transaction.setMeta(pendingChipsKey, {
		kind: 'land',
		key,
		to,
	} satisfies PendingChipChange);
}

export function dropPendingChips(transaction: Transaction, keys: readonly string[]): Transaction {
	return transaction.setMeta(pendingChipsKey, { kind: 'drop', keys } satisfies PendingChipChange);
}

function applyChange(
	chips: readonly PendingChip[],
	change: PendingChipChange,
): readonly PendingChip[] {
	switch (change.kind) {
		case 'add':
			return [...chips, change.chip];
		case 'drop':
			return chips.filter((chip) => !change.keys.includes(chip.key));
		case 'land': {
			const index = chips.findIndex((chip) => chip.key === change.key);
			const landed = chips[index];
			if (!landed) return chips;
			return chips.flatMap((chip, at) => {
				if (at === index) return [];
				return at > index && chip.pos === landed.pos ? [{ ...chip, pos: change.to }] : [chip];
			});
		}
	}
}

function isPendingChipChange(value: unknown): value is PendingChipChange {
	return typeof value === 'object' && value !== null && 'kind' in value;
}
