const ESCAPE_SEQUENCES =
	/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()][0-9A-Za-z]|[@-Z\\-_])/gu;
const ERASED_CHARACTER = /[^\n\u0008]\u0008/gu;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

const KEY_SEQUENCES: Readonly<Record<string, string>> = {
	Enter: '\r',
	Backspace: '\u007f',
	ArrowUp: '\u001b[A',
	ArrowDown: '\u001b[B',
	ArrowRight: '\u001b[C',
	ArrowLeft: '\u001b[D',
	Home: '\u001b[H',
	End: '\u001b[F',
	Delete: '\u001b[3~',
};

export type TerminalKey = Readonly<{ key: string; ctrlKey: boolean; metaKey: boolean }>;

export function terminalText(raw: string): string {
	let text = raw
		.replace(ESCAPE_SEQUENCES, '')
		.replaceAll('\r\n', '\n')
		.split('\n')
		.map(lastWrittenSegment)
		.join('\n');
	let previous: string;
	do {
		previous = text;
		text = text.replace(ERASED_CHARACTER, '');
	} while (text !== previous);
	return text.replace(CONTROL_CHARACTERS, '');
}

export function terminalKeySequence({ key, ctrlKey, metaKey }: TerminalKey): string | null {
	if (metaKey) return null;
	if (ctrlKey) {
		return /^[a-z]$/iu.test(key) ? String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64) : null;
	}
	return KEY_SEQUENCES[key] ?? null;
}

function lastWrittenSegment(line: string): string {
	return (
		line
			.split('\r')
			.filter((segment) => segment.length > 0)
			.at(-1) ?? ''
	);
}
