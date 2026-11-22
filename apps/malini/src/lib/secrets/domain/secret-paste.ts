const PAIR = /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[=:]\s*(.*)$/u;

export type PastedPair = Readonly<{ name: string; value: string }>;

export function pastedSecrets(text: string, names: readonly string[]): Record<string, string> {
	const found: Record<string, string> = {};
	for (const line of text.split(/\r?\n/u)) {
		const pair = pastedPair(line);
		if (pair && names.includes(pair.name)) found[pair.name] = pair.value;
	}
	return found;
}

export function pastedPair(line: string): PastedPair | null {
	const [, name, raw] = PAIR.exec(line) ?? [];
	if (name === undefined || raw === undefined) return null;
	const value = pairedValue(raw.trim());
	return value ? { name, value } : null;
}

function pairedValue(raw: string): string | null {
	const quote = raw[0];
	if (quote !== '"' && quote !== "'") return raw.replace(/\s+#.*$/u, '');
	const end = raw.indexOf(quote, 1);
	if (end === -1) return null;
	const value = raw.slice(1, end);
	return quote === '"' ? value.replaceAll('\\n', '\n') : value;
}
