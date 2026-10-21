export type ReadLine = Readonly<{ number: string | null; text: string }>;

const NUMBERED_LINE = /^\s*(\d+)(?:\t|→)(.*)$/u;

export function readOutputLines(output: string): readonly ReadLine[] {
	const lines = output.split('\n');
	const numbered = lines.flatMap((line) => {
		const match = NUMBERED_LINE.exec(line);
		return match ? [{ number: match[1] ?? null, text: match[2] ?? '' }] : [];
	});
	return numbered.length > 0 ? numbered : lines.map((text) => ({ number: null, text }));
}
