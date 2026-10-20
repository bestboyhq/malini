import type { AgentQuestion } from './agent-interaction';

export type AnsweredAgentQuestion = Readonly<{ question: AgentQuestion; answer: string }>;

// ponytail: parses Claude Code's `"prompt"="answer"` tool result; a format change shows a bare "Answered", an answer event fixes it
export function answersFromToolOutput(
	questions: readonly AgentQuestion[],
	output: unknown,
): readonly AnsweredAgentQuestion[] | null {
	if (typeof output !== 'string') return null;
	const markers = questions.map((question) => `"${question.prompt}"="`);
	const starts = markers.map((marker) => output.indexOf(marker));
	if (starts.some((start, index) => start < 0 || start < (starts[index - 1] ?? -1))) return null;
	const answers: AnsweredAgentQuestion[] = [];
	for (const [index, question] of questions.entries()) {
		const from = (starts[index] ?? 0) + (markers[index]?.length ?? 0);
		const next = starts[index + 1];
		const to = next === undefined ? output.lastIndexOf('"') : output.lastIndexOf('"', next - 1);
		if (to < from) return null;
		answers.push({ question, answer: output.slice(from, to) });
	}
	return answers;
}
