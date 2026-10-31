const PAIR = /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[=:]\s*(.*)$/u;

export function pastedSecrets(text: string, names: readonly string[]): Record<string, string> {
	const found: Record<string, string> = {};
	for (const line of text.split(/\r?\n/u)) {
		const [, name, raw] = PAIR.exec(line) ?? [];
		if (name === undefined || raw === undefined || !names.includes(name)) continue;
		const value = pairedValue(raw.trim());
		if (value) found[name] = value;
	}
	return found;
}

function pairedValue(raw: string): string | null {
	const quote = raw[0];
	if (quote !== '"' && quote !== "'") return raw.replace(/\s+#.*$/u, '');
	const end = raw.indexOf(quote, 1);
	if (end === -1) return null;
	const value = raw.slice(1, end);
	return quote === '"' ? value.replaceAll('\\n', '\n') : value;
}
