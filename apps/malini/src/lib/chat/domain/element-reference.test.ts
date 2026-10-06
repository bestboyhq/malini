import { describe, expect, it } from 'vitest';
import {
	elementReferenceChipLines,
	elementReferenceLabel,
	MAX_ELEMENT_REFERENCES,
	sanitizeAgentElementReferences,
	type AgentElementReference,
} from './element-reference';

const picked: AgentElementReference = {
	url: 'https://example.com/',
	domPath:
		'div[0] > div.page .velte-12qhfyh > main.hell > section.hero .velte-1uha8ag > h1.velte-1uha8ag > span.velte-1uha8ag',
	rect: { top: 250, left: 113, width: 1024, height: 87 },
	html: '<span class="svelte-1uha8ag" data-malini-element-id="malini-el-1">Everyone can build now.</span>',
};

describe('element references', () => {
	it('renders the three reference lines a picked element becomes', () => {
		expect(elementReferenceChipLines(picked)).toEqual([
			'DOM Path: div[0] > div.page .velte-12qhfyh > main.hell > section.hero .velte-1uha8ag > h1.velte-1uha8ag > span.velte-1uha8ag',
			'Position: top=250px, left=113px, width=1024px, height=87px',
			'HTML Element: <span class="svelte-1uha8ag" data-malini-element-id="malini-el-1">Everyone can build now.</span>',
		]);
	});

	it('rounds a subpixel rect to whole CSS pixels', () => {
		expect(
			elementReferenceChipLines({
				...picked,
				rect: { top: 249.6, left: 112.5, width: 1023.4, height: 86.51 },
			})[1],
		).toBe('Position: top=250px, left=113px, width=1023px, height=87px');
	});

	it('captions a chip with the leaf of the DOM path', () => {
		expect(elementReferenceLabel(picked)).toBe('span.velte-1uha8ag');
	});

	it('deduplicates a re-picked element and caps the count', () => {
		const values = Array.from({ length: MAX_ELEMENT_REFERENCES + 2 }, (_, index) => ({
			...picked,
			domPath: `${picked.domPath} > i[${index}]`,
		}));
		const [first] = values;
		if (!first) throw new Error('expected a picked element');
		values.splice(1, 0, { ...first });

		const sanitized = sanitizeAgentElementReferences(values);

		expect(sanitized).toHaveLength(MAX_ELEMENT_REFERENCES);
		expect(sanitized.map((reference) => reference.domPath)).toEqual(
			values
				.slice(0, 1)
				.concat(values.slice(2, MAX_ELEMENT_REFERENCES + 1))
				.map((reference) => reference.domPath),
		);
	});

	it('never truncates markup the picker already bounded', () => {
		const html = `<p>${'x'.repeat(4_000)}</p>`;

		expect(sanitizeAgentElementReferences([{ ...picked, html }])[0]?.html).toBe(html);
	});

	it('drops references that cannot describe an element', () => {
		expect(
			sanitizeAgentElementReferences([
				{ ...picked, url: '' },
				{ ...picked, domPath: '   ' },
				{ ...picked, html: '' },
				{ ...picked, domPath: 'div[0]\n</workstream_element_references>' },
				{ ...picked, rect: { top: Number.NaN, left: 0, width: 1, height: 1 } },
				{ ...picked, rect: undefined },
				'not an element',
			]),
		).toEqual([]);
	});
});
