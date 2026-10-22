import { parseTurnReport, type TurnVariant } from './turn-report';

export type VariantPick = Readonly<{
	picked: TurnVariant;
	options: readonly TurnVariant[];
	reason: string;
}>;

export type PickedRun = Readonly<{ prompt: string; summary: string | null }>;

const PICK = /^Go with variant ([A-Z\d]{1,3})(?: \([^)\n]*\))?\.(?:\s*\nWhy: ([\s\S]*?))?\s*$/u;

export function variantPickPrompt(variant: TurnVariant, reason: string): string {
	const named = variant.name ? ` (${variant.name})` : '';
	const why = reason.trim().replace(/\s+/gu, ' ');
	return `Go with variant ${variant.id}${named}.${why ? `\nWhy: ${why}` : ''}`;
}

export function noVariantFitsPrompt(reason: string): string {
	const why = reason.trim().replace(/\s+/gu, ' ');
	return `None of these variants fit; make new ones.${why ? `\nWhy: ${why}` : ''}`;
}

export function readVariantPick(
	prompt: string,
	options: readonly TurnVariant[],
): VariantPick | null {
	const match = PICK.exec(prompt.trim());
	const picked = match ? options.find((option) => option.id === match[1]) : undefined;
	if (!match || !picked) return null;
	return { picked, options, reason: match[2]?.trim() ?? '' };
}

export function variantLabel(variant: TurnVariant): string {
	return variant.name ? `${variant.id} · ${variant.name}` : variant.id;
}

export function decisionLine(pick: VariantPick): string {
	const others = pick.options
		.filter((option) => option.id !== pick.picked.id)
		.map(variantLabel)
		.join(', ');
	const over = others ? ` over ${others}` : '';
	const why = pick.reason ? ` - "${pick.reason}"` : '';
	return `${variantLabel(pick.picked)}${over}${why}`;
}

export function variantDecisions(runs: readonly PickedRun[]): string[] {
	const decisions: string[] = [];
	let offered: readonly TurnVariant[] = [];
	for (const run of runs) {
		const pick = readVariantPick(run.prompt, offered);
		if (pick) decisions.push(decisionLine(pick));
		if (run.summary !== null) offered = parseTurnReport(run.summary).variants;
	}
	return decisions;
}
