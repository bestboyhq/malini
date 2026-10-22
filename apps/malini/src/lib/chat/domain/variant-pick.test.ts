import { describe, expect, it } from 'vitest';
import type { TurnVariant } from './turn-report';
import {
	decisionLine,
	noVariantFitsPrompt,
	readVariantPick,
	variantDecisions,
	variantPickPrompt,
} from './variant-pick';

const CALM: TurnVariant = { id: 'A', name: 'Calm', note: 'lots of air', src: 'a.png' };
const BOLD: TurnVariant = { id: 'B', name: 'Bold', note: '', src: 'b.png' };
const OFFER = [
	'![Variant A: Calm - lots of air](a.png)',
	'![Variant B: Bold](b.png)',
	'',
	'Outcome: Two directions.',
	'Needs: Pick one',
].join('\n');

describe('variant pick', () => {
	it('round-trips the prompt a pick sends, reason and all', () => {
		const prompt = variantPickPrompt(BOLD, '  darker reads\nbetter ');

		expect(prompt).toBe('Go with variant B (Bold).\nWhy: darker reads better');
		expect(readVariantPick(prompt, [CALM, BOLD])).toEqual({
			picked: BOLD,
			options: [CALM, BOLD],
			reason: 'darker reads better',
		});
		expect(readVariantPick(variantPickPrompt(CALM, ''), [CALM, BOLD])?.reason).toBe('');
	});

	it('asks for new variants, with the reason none fit, without reading it as a pick', () => {
		const prompt = noVariantFitsPrompt('all too loud');

		expect(prompt).toBe('None of these variants fit; make new ones.\nWhy: all too loud');
		expect(readVariantPick(prompt, [CALM, BOLD])).toBeNull();
	});

	it('reads no pick from other prompts or for a variant that was never offered', () => {
		expect(readVariantPick('Go with the bold one', [CALM, BOLD])).toBeNull();
		expect(readVariantPick('Go with variant C (Loud).', [CALM, BOLD])).toBeNull();
		expect(readVariantPick('Go with variant B (Bold).\nWhy: fine\n\nAlso fix CI', [BOLD])).toEqual({
			picked: BOLD,
			options: [BOLD],
			reason: 'fine\n\nAlso fix CI',
		});
	});

	it('writes a decision line naming what lost and why', () => {
		expect(decisionLine({ picked: BOLD, options: [CALM, BOLD], reason: 'darker' })).toBe(
			'B · Bold over A · Calm - "darker"',
		);
		expect(decisionLine({ picked: CALM, options: [CALM], reason: '' })).toBe('A · Calm');
	});

	it('collects the decisions a chat made, each against the variants offered right before it', () => {
		expect(
			variantDecisions([
				{ prompt: 'Give me hero directions', summary: OFFER },
				{ prompt: 'Go with variant B (Bold).\nWhy: darker', summary: 'Outcome: Built B.' },
				{ prompt: 'Go with variant A (Calm).', summary: null },
			]),
		).toEqual(['B · Bold over A · Calm - "darker"']);
	});
});
