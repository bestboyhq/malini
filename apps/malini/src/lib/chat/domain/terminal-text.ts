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

export function terminalKeySequence({ key, ctrlKey, metaKey }: TerminalKey): string | null {
	if (metaKey) return null;
	if (ctrlKey) {
		return /^[a-z]$/iu.test(key) ? String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64) : null;
	}
	return KEY_SEQUENCES[key] ?? null;
}
