import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const glyphsDir = join(root, 'packages/hyper-ui/src/icons/glyphs');
const { chromium } = createRequire(join(root, 'apps/malini/package.json'))('@playwright/test');
const { GLYPH_FRAME, compileGlyphs } = await import(
	join(root, 'packages/hyper-ui/scripts/icons.mjs')
);

const [filter = '', out = '.context/icons/sheet.png'] = process.argv.slice(2);
const wanted = filter ? new Set(filter.split(',')) : null;
const names = readdirSync(glyphsDir)
	.filter((file) => file.endsWith('.svg'))
	.map((file) => file.slice(0, -4))
	.filter((name) => !wanted || wanted.has(name))
	.sort();
if (names.length === 0) throw new Error(`no glyphs match ${filter}`);

const glyphs = compileGlyphs(
	Object.fromEntries(
		names.map((name) => [name, readFileSync(join(glyphsDir, `${name}.svg`), 'utf8')]),
	),
);
const frame = Object.entries(GLYPH_FRAME)
	.map(([key, value]) => `${key}="${value}"`)
	.join(' ');
const shapes = (name) => {
	const { outline, solid } = glyphs[name];
	return `${outline ? `<path d="${outline}"/>` : ''}${solid ? `<path d="${solid}" fill="currentColor"/>` : ''}`;
};

const sized = (svg, size) =>
	svg.replace('width="16" height="16"', `width="${size}" height="${size}"`);
const grid = Array.from({ length: 17 }, (_, at) => {
	const line = at % 4 === 0 ? '#cfd6e4' : '#eceff5';
	return `<path d="M${at} 0V16M0 ${at}H16" stroke="${line}" stroke-width="0.05"/>`;
}).join('');
const keylines =
	'<rect x="1.75" y="1.75" width="12.5" height="12.5" fill="none" stroke="#ff6b6b" stroke-width="0.05" stroke-dasharray="0.25 0.25"/>' +
	'<circle cx="8" cy="8" r="5.75" fill="none" stroke="#5aa9ff" stroke-width="0.05"/>' +
	'<rect x="2.75" y="2.75" width="10.5" height="10.5" fill="none" stroke="#5aa9ff" stroke-width="0.05"/>';

const cell = (name) => {
	const inner = shapes(name);
	const svg = `<svg ${frame}>${inner}</svg>`;
	const zoom = `<svg width="112" height="112" viewBox="0 0 16 16">${grid}${keylines}<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">${inner}</g></svg>`;
	return `<figure>
		${zoom}
		<div class="sizes light">${[12, 14, 16, 20].map((size) => sized(svg, size)).join('')}</div>
		<div class="sizes dark">${[12, 14, 16, 20].map((size) => sized(svg, size)).join('')}</div>
		<div class="inline">${sized(svg, 14)}<span>Label text</span></div>
		<figcaption>${name}</figcaption>
	</figure>`;
};

const html = `<!doctype html><style>
	body { margin: 16px; font: 13px -apple-system, system-ui; background: #fff; color: #1d1d1f;
		display: grid; grid-template-columns: repeat(6, 150px); gap: 12px; }
	figure { margin: 0; padding: 10px; border: 1px solid #eee; border-radius: 10px;
		display: flex; flex-direction: column; align-items: center; gap: 8px; }
	.sizes { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; }
	.light { color: #3a3a3c; }
	.dark { background: #1c1c1e; color: #d1d1d6; }
	.inline { display: flex; align-items: center; gap: 6px; color: #636366; }
	figcaption { font: 12px ui-monospace, monospace; color: #8e8e93; }
</style>${names.map(cell).join('')}`;

mkdirSync(dirname(resolve(root, out)), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
	deviceScaleFactor: 2,
	viewport: { width: 1000, height: 600 },
});
await page.setContent(html);
await page.screenshot({ path: resolve(root, out), fullPage: true });
const drift = await page.evaluate(
	async (pairs) => {
		const raster = async (svg) => {
			const image = new Image();
			image.src = `data:image/svg+xml,${encodeURIComponent(svg.replace('width="16" height="16"', 'width="64" height="64"').replaceAll('currentColor', '#000'))}`;
			await image.decode();
			const context = new OffscreenCanvas(64, 64).getContext('2d');
			context.drawImage(image, 0, 0);
			return context.getImageData(0, 0, 64, 64).data;
		};
		const drifted = [];
		for (const [name, source, compiled] of pairs) {
			const [a, b] = await Promise.all([raster(source), raster(compiled)]);
			let pixels = 0;
			for (let at = 3; at < a.length; at += 4) if (Math.abs(a[at] - b[at]) > 64) pixels += 1;
			if (pixels > 4) drifted.push(name);
		}
		return drifted;
	},
	names.map((name) => [
		name,
		readFileSync(join(glyphsDir, `${name}.svg`), 'utf8'),
		`<svg ${frame}>${shapes(name)}</svg>`,
	]),
);
await browser.close();
console.log(resolve(root, out));
if (drift.length > 0) {
	console.error(`the generated drawing differs from the source for: ${drift.join(', ')}`);
	process.exit(1);
}
