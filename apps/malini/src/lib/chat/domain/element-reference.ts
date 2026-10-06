export type AgentElementRect = Readonly<{
	top: number;
	left: number;
	width: number;
	height: number;
}>;

export type AgentElementReference = Readonly<{
	url: string;
	domPath: string;
	rect: AgentElementRect;
	html: string;
}>;

export const MAX_ELEMENT_REFERENCES = 5;

export function elementReferenceChipLines(
	reference: AgentElementReference,
): readonly [string, string, string] {
	const { top, left, width, height } = reference.rect;
	return [
		`DOM Path: ${reference.domPath}`,
		`Position: top=${cssPixels(top)}, left=${cssPixels(left)}, width=${cssPixels(width)}, height=${cssPixels(height)}`,
		`HTML Element: ${reference.html}`,
	];
}

export function elementReferenceLabel(reference: AgentElementReference): string {
	const leaf = reference.domPath.split('>').at(-1)?.trim();
	return leaf || reference.url;
}

export function elementReferenceKey(reference: AgentElementReference): string {
	return `${reference.url}\n${reference.domPath}`;
}

export function sanitizeAgentElementReferences(value: unknown): AgentElementReference[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const references: AgentElementReference[] = [];
	for (const candidate of value) {
		const reference = readElementReference(candidate);
		if (!reference) continue;
		const key = elementReferenceKey(reference);
		if (seen.has(key)) continue;
		seen.add(key);
		references.push(reference);
		if (references.length >= MAX_ELEMENT_REFERENCES) break;
	}
	return references;
}

function readElementReference(candidate: unknown): AgentElementReference | null {
	if (!isRecord(candidate)) return null;
	const { url, domPath, html, rect } = candidate;
	if (typeof url !== 'string' || typeof domPath !== 'string' || typeof html !== 'string') {
		return null;
	}
	const normalizedUrl = url.trim();
	const normalizedDomPath = domPath.trim();
	if (!normalizedUrl || !normalizedDomPath || !html.trim()) return null;
	if (/[\n\r\0]/u.test(normalizedUrl) || /[\n\r\0]/u.test(normalizedDomPath)) return null;
	const normalizedRect = readElementRect(rect);
	if (!normalizedRect) return null;
	return { url: normalizedUrl, domPath: normalizedDomPath, rect: normalizedRect, html };
}

function readElementRect(value: unknown): AgentElementRect | null {
	if (!isRecord(value)) return null;
	const { top, left, width, height } = value;
	if (
		!isFiniteNumber(top) ||
		!isFiniteNumber(left) ||
		!isFiniteNumber(width) ||
		!isFiniteNumber(height)
	) {
		return null;
	}
	return { top, left, width, height };
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cssPixels(value: number): string {
	return `${Math.round(value)}px`;
}
