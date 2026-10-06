import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(import.meta.url), '../..');
const glyphsDir = resolve(packageRoot, 'src/icons/glyphs');
const outputPath = resolve(packageRoot, 'src/icons/glyphs.generated.ts');

export const GLYPH_FRAME = {
	xmlns: 'http://www.w3.org/2000/svg',
	width: '16',
	height: '16',
	viewBox: '0 0 16 16',
	fill: 'none',
	stroke: 'currentColor',
	'stroke-width': '1.5',
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
};

const LIVE_AREA = { min: 1.75, max: 14.25 };

/** @type {Record<string, { required: string[]; optional: string[] }>} */
const SHAPES = {
	path: { required: ['d'], optional: ['fill'] },
	circle: { required: ['cx', 'cy', 'r'], optional: ['fill'] },
	ellipse: { required: ['cx', 'cy', 'rx', 'ry'], optional: ['fill'] },
	rect: { required: ['x', 'y', 'width', 'height'], optional: ['rx', 'ry', 'fill'] },
	line: { required: ['x1', 'y1', 'x2', 'y2'], optional: [] },
	polyline: { required: ['points'], optional: [] },
	polygon: { required: ['points'], optional: ['fill'] },
};

/** @type {Record<string, number>} */
const PATH_ARITY = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const TAG = /\s*<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>\s*/y;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;

/**
 * @typedef {{ outline: string; solid: string }} Glyph
 * @typedef {{ name: string; attributes: Record<string, string>; selfClosing: boolean; closing: boolean }} Tag
 */

/**
 * @param {string} name
 * @param {string} source
 * @returns {Glyph}
 */
export function compileGlyph(name, source) {
	/** @type {string[]} */
	const problems = [];
	if (!NAME.test(name)) problems.push('the file name must be kebab-case, like `arrow-right.svg`');

	const tags = parseTags(source, problems);
	const [root, ...rest] = tags;
	const closing = rest.pop();
	if (!root || root.name !== 'svg' || root.closing || root.selfClosing) {
		problems.push('the file must start with an `<svg>` element');
	} else {
		checkFrame(root.attributes, problems);
	}
	if (!closing || closing.name !== 'svg' || !closing.closing) {
		problems.push('the file must end with `</svg>`');
	}

	/** @type {string[]} */
	const outline = [];
	/** @type {string[]} */
	const solid = [];
	for (const tag of rest) {
		const path = compileShape(tag, problems);
		if (path === null) continue;
		(tag.attributes.fill === 'currentColor' ? solid : outline).push(path);
	}
	if (rest.length === 0) problems.push('the glyph has no shapes');

	if (problems.length > 0) {
		throw new Error(`${name}.svg:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
	}
	return { outline: outline.join(''), solid: solid.join('') };
}

/**
 * @param {string} source
 * @param {string[]} problems
 * @returns {Tag[]}
 */
function parseTags(source, problems) {
	/** @type {Tag[]} */
	const tags = [];
	let index = 0;
	while (index < source.length) {
		TAG.lastIndex = index;
		const match = TAG.exec(source);
		if (!match) {
			const snippet = source.slice(index, index + 30).trim();
			problems.push(`only plain elements are allowed, found \`${snippet}\``);
			return tags;
		}
		const [, slash = '', name = '', rawAttributes = '', selfClose = ''] = match;
		/** @type {Record<string, string>} */
		const attributes = {};
		for (const [, key = '', value = ''] of rawAttributes.matchAll(ATTRIBUTE)) {
			attributes[key] = value;
		}
		tags.push({ name, attributes, selfClosing: selfClose === '/', closing: slash === '/' });
		index = TAG.lastIndex;
	}
	return tags;
}

/**
 * @param {Record<string, string>} attributes
 * @param {string[]} problems
 */
function checkFrame(attributes, problems) {
	for (const [key, value] of Object.entries(GLYPH_FRAME)) {
		if (attributes[key] !== value) problems.push(`<svg> needs ${key}="${value}"`);
	}
	for (const key of Object.keys(attributes)) {
		if (!(key in GLYPH_FRAME)) problems.push(`<svg> cannot carry ${key}`);
	}
}

/**
 * @param {Tag} tag
 * @param {string[]} problems
 * @returns {string | null}
 */
function compileShape(tag, problems) {
	const shape = SHAPES[tag.name];
	if (!shape || tag.closing || !tag.selfClosing) {
		problems.push(
			`<${tag.name}> is not allowed: use self-closing ${Object.keys(SHAPES).join(', ')}`,
		);
		return null;
	}
	const before = problems.length;
	const allowed = new Set([...shape.required, ...shape.optional]);
	for (const key of shape.required) {
		if (tag.attributes[key] === undefined) problems.push(`<${tag.name}> needs ${key}`);
	}
	for (const [key, value] of Object.entries(tag.attributes)) {
		if (!allowed.has(key)) {
			problems.push(`<${tag.name}> cannot carry ${key}; the frame owns stroke and colour`);
		} else if (key === 'fill' && value !== 'currentColor') {
			problems.push(`<${tag.name}> fill must be "currentColor" or absent`);
		} else if (key !== 'fill') {
			checkPrecision(tag.name, key, value, problems);
		}
	}
	if (problems.length > before) return null;

	const { d, points } = shapeGeometry(tag.name, tag.attributes, problems);
	for (const [x, y] of points) {
		if (!inLiveArea(x) || !inLiveArea(y)) {
			problems.push(
				`<${tag.name}> reaches ${format(x)},${format(y)}, outside the ${LIVE_AREA.min} to ${LIVE_AREA.max} live area`,
			);
			break;
		}
	}
	return d;
}

/**
 * @param {string} element
 * @param {string} key
 * @param {string} value
 * @param {string[]} problems
 */
function checkPrecision(element, key, value, problems) {
	for (const [number] of value.matchAll(NUMBER)) {
		if (/e/i.test(number) || (number.split('.')[1]?.length ?? 0) > 2) {
			problems.push(`<${element}> ${key} has ${number}; round to at most 2 decimals`);
			return;
		}
	}
}

/**
 * @param {number} value
 */
const inLiveArea = (value) => value >= LIVE_AREA.min - 1e-9 && value <= LIVE_AREA.max + 1e-9;

/**
 * @param {number} value
 */
const format = (value) => String(Math.round(value * 1000) / 1000);

/**
 * @param {string} element
 * @param {Record<string, string>} attributes
 * @param {string[]} problems
 * @returns {{ d: string; points: Array<[number, number]> }}
 */
function shapeGeometry(element, attributes, problems) {
	/** @param {string} key */
	const n = (key) => Number(attributes[key] ?? 0);
	if (element === 'circle' || element === 'ellipse') {
		const cx = n('cx');
		const cy = n('cy');
		const rx = element === 'circle' ? n('r') : n('rx');
		const ry = element === 'circle' ? n('r') : n('ry');
		const arc = (/** @type {number} */ dx) => `a${format(rx)} ${format(ry)} 0 1 0 ${format(dx)} 0`;
		return {
			d: `M${format(cx - rx)} ${format(cy)}${arc(2 * rx)}${arc(-2 * rx)}Z`,
			points: [
				[cx - rx, cy - ry],
				[cx + rx, cy + ry],
			],
		};
	}
	if (element === 'rect') {
		const x = n('x');
		const y = n('y');
		const width = n('width');
		const height = n('height');
		const rx = Math.min(Number(attributes.rx ?? attributes.ry ?? 0), width / 2);
		const ry = Math.min(Number(attributes.ry ?? attributes.rx ?? 0), height / 2);
		const corner = (/** @type {number} */ dx, /** @type {number} */ dy) =>
			rx > 0 ? `a${format(rx)} ${format(ry)} 0 0 1 ${format(dx)} ${format(dy)}` : '';
		return {
			d:
				`M${format(x + rx)} ${format(y)}h${format(width - 2 * rx)}${corner(rx, ry)}` +
				`v${format(height - 2 * ry)}${corner(-rx, ry)}h${format(2 * rx - width)}` +
				`${corner(-rx, -ry)}v${format(2 * ry - height)}${corner(rx, -ry)}Z`,
			points: [
				[x, y],
				[x + width, y + height],
			],
		};
	}
	if (element === 'line') {
		const points = /** @type {Array<[number, number]>} */ ([
			[n('x1'), n('y1')],
			[n('x2'), n('y2')],
		]);
		return { d: polyline(points, false), points };
	}
	if (element === 'polyline' || element === 'polygon') {
		const values = (attributes.points ?? '').match(NUMBER)?.map(Number) ?? [];
		if (values.length < 4 || values.length % 2 !== 0) {
			problems.push(`<${element}> points must be x,y pairs`);
			return { d: '', points: [] };
		}
		/** @type {Array<[number, number]>} */
		const points = [];
		for (let index = 0; index < values.length; index += 2) {
			points.push([values[index] ?? 0, values[index + 1] ?? 0]);
		}
		return { d: polyline(points, element === 'polygon'), points };
	}
	const d = (attributes.d ?? '').trim();
	return { d: absoluteStart(d), points: pathPoints(d, problems) };
}

/**
 * @param {string} d
 */
function absoluteStart(d) {
	const start = /^m\s*(-?(?:\d+\.?\d*|\.\d+))[\s,]*(-?(?:\d+\.?\d*|\.\d+))[\s,]*/.exec(d);
	if (!start) return d;
	const rest = d.slice(start[0].length);
	return `M${start[1]} ${start[2]}${/^[-.\d]/.test(rest) ? 'l' : ''}${rest}`;
}

/**
 * @param {Array<[number, number]>} points
 * @param {boolean} closed
 */
function polyline(points, closed) {
	const [first, ...rest] = points.map(([x, y]) => `${format(x)} ${format(y)}`);
	return `M${first}${rest.map((point) => `L${point}`).join('')}${closed ? 'Z' : ''}`;
}

/**
 * @param {string} d
 * @param {string[]} problems
 * @returns {Array<[number, number]>}
 */
export function pathPoints(d, problems) {
	const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
	if (d.replace(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)|[\s,]/g, '') !== '' || !/^[mM]/.test(d)) {
		problems.push('<path> d must start with M and hold only commands and numbers');
		return [];
	}
	/** @type {Array<[number, number]>} */
	const points = [];
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let index = 0;
	while (index < tokens.length) {
		const command = tokens[index] ?? '';
		index += 1;
		const lower = command.toLowerCase();
		const arity = PATH_ARITY[lower];
		if (arity === undefined) {
			problems.push(`<path> d has the unknown command ${command}`);
			return points;
		}
		const relative = command === lower;
		if (arity === 0) {
			x = startX;
			y = startY;
			continue;
		}
		let first = true;
		while (index < tokens.length && !/[a-zA-Z]/.test(tokens[index] ?? '')) {
			const args = tokens.slice(index, index + arity).map(Number);
			if (args.length < arity || args.some((value) => Number.isNaN(value))) {
				problems.push(`<path> d has an incomplete ${command} segment`);
				return points;
			}
			index += arity;
			const ox = relative ? x : 0;
			const oy = relative ? y : 0;
			/** @type {Array<[number, number]>} */
			let segment = [];
			if (lower === 'h') {
				x = (args[0] ?? 0) + ox;
			} else if (lower === 'v') {
				y = (args[0] ?? 0) + oy;
			} else if (lower === 'a') {
				x = (args[5] ?? 0) + ox;
				y = (args[6] ?? 0) + oy;
			} else {
				for (let at = 0; at < arity; at += 2) {
					segment.push([(args[at] ?? 0) + ox, (args[at + 1] ?? 0) + oy]);
				}
				const end = segment[segment.length - 1] ?? [x, y];
				[x, y] = end;
			}
			if (lower === 'm' && first) {
				startX = x;
				startY = y;
			}
			first = false;
			points.push(...segment, [x, y]);
		}
	}
	return points;
}

/**
 * @param {Record<string, Glyph>} glyphs
 */
export function renderModule(glyphs) {
	const frame = Object.entries(GLYPH_FRAME)
		.filter(([key]) => key !== 'xmlns' && key !== 'width' && key !== 'height')
		.map(([key, value]) => `\t${JSON.stringify(key)}: ${JSON.stringify(value)},`)
		.join('\n');
	const entries = Object.entries(glyphs)
		.map(
			([name, glyph]) =>
				`\t${JSON.stringify(name)}: { outline: ${JSON.stringify(glyph.outline)}, solid: ${JSON.stringify(glyph.solid)} },`,
		)
		.join('\n');
	return (
		`// Generated by packages/hyper-ui/scripts/icons.mjs from src/icons/glyphs/*.svg. Do not edit.\n\n` +
		`export const glyphFrame = {\n${frame}\n} as const;\n\n` +
		`export const glyphs = {\n${entries}\n} as const satisfies Record<string, { outline: string; solid: string }>;\n\n` +
		`export type IconName = keyof typeof glyphs;\n`
	);
}

/**
 * @param {Record<string, string>} sources
 * @returns {Record<string, Glyph>}
 */
export function compileGlyphs(sources) {
	/** @type {Record<string, Glyph>} */
	const glyphs = {};
	/** @type {Map<string, string>} */
	const drawings = new Map();
	/** @type {string[]} */
	const errors = [];
	for (const name of Object.keys(sources).sort()) {
		try {
			const glyph = compileGlyph(name, sources[name] ?? '');
			const drawing = `${glyph.outline}|${glyph.solid}`;
			const twin = drawings.get(drawing);
			if (twin) throw new Error(`${name}.svg: draws the same glyph as ${twin}.svg; use that one`);
			drawings.set(drawing, name);
			glyphs[name] = glyph;
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (errors.length > 0) throw new Error(errors.join('\n'));
	return glyphs;
}

async function main() {
	const files = (await readdir(glyphsDir)).filter((file) => file.endsWith('.svg'));
	/** @type {Record<string, string>} */
	const sources = {};
	for (const file of files) {
		sources[file.slice(0, -'.svg'.length)] = await readFile(resolve(glyphsDir, file), 'utf8');
	}
	const module = renderModule(compileGlyphs(sources));
	const existing = await readFile(outputPath, 'utf8').catch(() => '');
	if (existing !== module) {
		if (process.argv.includes('--check')) {
			throw new Error(`${outputPath} is stale; run pnpm --filter @malini/hyper-ui icons`);
		}
		await writeFile(outputPath, module, 'utf8');
	}
	console.log(`icons: ${files.length} glyphs`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
