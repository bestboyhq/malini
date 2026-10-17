import { describe, expect, it } from 'vitest';
import type { AgentQuestion } from './agent-interaction';
import { answersFromToolOutput } from './agent-question-answers';

function question(id: string, prompt: string): AgentQuestion {
	return { id, prompt, options: [], multiSelect: false, allowFreeText: true };
}

const mode = question('q0', 'What should choosing a mode in Custom game do?');
const range = question('q1', 'In a custom game, is the Shooting range played together?');
const quoted = question('q0', 'Which description? (Current: "Grip is a recorder.")');

describe('answers from the AskUserQuestion tool output', () => {
	it('pairs each question with its answer in both Claude Code formats', () => {
		expect(
			answersFromToolOutput(
				[mode, range],
				`Your questions have been answered: "${mode.prompt}"="Room, mode on its stage (Recommended)", "${range.prompt}"="Together, on the server". You can now continue with these answers in mind.`,
			)?.map(({ answer }) => answer),
		).toEqual(['Room, mode on its stage (Recommended)', 'Together, on the server']);
		expect(
			answersFromToolOutput(
				[quoted],
				`The user answered: "${quoted.prompt}"="no "winner", synergize them". Read the answers carefully — they may request clarification — and follow what they actually say.`,
			)?.map(({ answer }) => answer),
		).toEqual(['no "winner", synergize them']);
	});

	it('gives up on output it cannot read', () => {
		expect(answersFromToolOutput([mode], undefined)).toBeNull();
		expect(answersFromToolOutput([mode], 'User declined to answer')).toBeNull();
		expect(
			answersFromToolOutput(
				[mode, range],
				`"${range.prompt}"="Together", "${mode.prompt}"="Room".`,
			),
		).toBeNull();
	});
});
