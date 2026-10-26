import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { COMMAND, IMAGE, readOgView, SOURCE } from '../scripts/og-image.ts';
import { LOGDASH_SITE } from '../src/lib/logdash.ts';
import worker, { type Env } from '../worker/index.ts';

const SITE = 'https://bestboy.dev/malini';
const root = join(import.meta.dirname, '..');
const build = join(root, 'build', 'malini');
const content = join(root, 'content');

function markdownFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.md'))
		.map((file) => relative(content, join(dir, file)));
}

const docPaths = markdownFiles(content).map(
	(file) => `/docs/${file.replace(/\.md$/u, '')}`.replace(/\/index$/u, '') || '/docs',
);
const htmlPaths = ['', ...docPaths];

function read(path: string): string {
	return readFileSync(join(build, path), 'utf8');
}

function htmlFile(path: string): string {
	return path === '' ? 'index.html' : `${path.slice(1)}.html`;
}

test('llms.txt links the markdown of every content page', () => {
	const llms = read('llms.txt');
	for (const path of docPaths) assert.ok(llms.includes(`(${SITE}${path}.md)`), path);
});

test('every content page is served as markdown next to its page', () => {
	for (const path of docPaths) assert.ok(read(`${path.slice(1)}.md`).length > 0, path);
});

test('llms-full.txt holds every content page', () => {
	const full = read('llms-full.txt');
	for (const path of docPaths) assert.ok(full.includes(`Source: ${SITE}${path}\n`), path);
});

test('every page has one canonical URL under bestboy.dev/malini and a description', () => {
	for (const path of htmlPaths) {
		const html = read(htmlFile(path));
		const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/gu)];
		assert.deepEqual(
			canonicals.map((match) => match[1]),
			[`${SITE}${path}`],
			path,
		);
		assert.match(html, /<meta name="description" content="[^"]+"/u, path);
	}
});

test('the sitemap lists every page by its canonical URL', () => {
	const sitemap = read('sitemap.xml');
	const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
	assert.deepEqual(locs.toSorted(), htmlPaths.map((path) => `${SITE}${path}`).toSorted());
});

const assets: Env = {
	ASSETS: {
		fetch: (request) =>
			Promise.resolve(
				new Response(new URL(request.url).pathname, {
					headers: { 'Set-Cookie': 'a=b', 'Content-Type': 'text/html' },
				}),
			),
	},
};

function get(url: string): Promise<Response> {
	return worker.fetch(new Request(url), assets);
}

test('the worker marks every host but bestboy.dev noindex and never sets cookies', async () => {
	const canonical = await get('https://bestboy.dev/malini/docs');
	assert.equal(canonical.headers.get('X-Robots-Tag'), null);
	assert.equal(canonical.headers.get('Set-Cookie'), null);
	const preview = await get('https://malini-site.bestboy.workers.dev/malini/docs');
	assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex');
});

test('the worker drops trailing slashes with a permanent redirect', async () => {
	const response = await get('https://bestboy.dev/malini/docs/jobs/?x=1');
	assert.equal(response.status, 301);
	assert.equal(response.headers.get('Location'), 'https://bestboy.dev/malini/docs/jobs?x=1');
	assert.equal((await get('https://bestboy.dev/malini/')).headers.get('Location'), SITE);
});

test('the worker caches immutable assets for a year and lets pages revalidate in the background', async () => {
	const asset = await get('https://bestboy.dev/malini/_app/immutable/assets/0.abc.css');
	assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
	const swr = 'public, max-age=0, stale-while-revalidate=86400';
	for (const path of ['', '/docs/jobs', '/docs/jobs/__data.json', '/__data.json']) {
		assert.equal((await get(`${SITE}${path}`)).headers.get('Cache-Control'), swr, path);
	}
	assert.equal((await get(`${SITE}/docs/jobs.md`)).headers.get('Cache-Control'), null);
	assert.equal((await get(`${SITE}/llms.txt`)).headers.get('Cache-Control'), null);
});

test('every page loads Logdash from the Malini site and reports to it', () => {
	for (const path of htmlPaths) {
		const html = read(htmlFile(path));
		assert.match(html, /<script defer="" src="\/malini\/_ld\/script\.js"/u, path);
		assert.match(html, new RegExp(`data-site="${LOGDASH_SITE}"`, 'u'), path);
		assert.match(html, /data-endpoint="\/malini\/_ld\/events"/u, path);
	}
});

test('the worker refuses Logdash events that are not from a Malini page', async () => {
	const send = (body: object, type = 'application/json') =>
		worker.fetch(
			new Request(`${SITE}/_ld/events`, {
				method: 'POST',
				headers: { 'Content-Type': type },
				body: JSON.stringify(body),
			}),
			assets,
		);
	const event = { name: 'pageview', path: '/malini' };
	const batch = (events: object[]) => ({ siteId: LOGDASH_SITE, events });
	assert.equal((await send(batch([event]), 'text/plain')).status, 415);
	assert.equal((await send({ siteId: '0'.repeat(24), events: [event] })).status, 400);
	assert.equal((await send(batch([event, { ...event, path: '/' }]))).status, 400);
	assert.equal((await send(batch([]))).status, 400);
	assert.equal((await send(batch(Array(21).fill(event)))).status, 400);
	const big = await send(batch([{ ...event, pad: '€'.repeat(11000) }]));
	assert.equal(big.status, 413);
	assert.equal(big.headers.get('Cache-Control'), 'no-store');
});

test('every content page is prerendered as a page and as client navigation data', () => {
	for (const path of docPaths) {
		assert.ok(existsSync(join(build, htmlFile(path))), path);
		assert.ok(existsSync(join(build, path.slice(1), '__data.json')), path);
	}
});

test('pages ship the client router and preload links on hover', () => {
	for (const path of htmlPaths) {
		const html = read(htmlFile(path));
		assert.match(html, /data-sveltekit-preload-data="hover"/u, path);
		assert.match(html, /<script type="module"|import\(/u, path);
	}
});

test('the Open Graph image shows the hero as it is now', () => {
	assert.equal(
		readOgView().source,
		readFileSync(SOURCE, 'utf8').trim(),
		`The hero changed since src/lib/og.png was rendered. Run ${COMMAND}, then check that og:image:alt in src/lib/Head.svelte still describes it.`,
	);
});

test('every page shares the Open Graph image under a URL that changes with its content', () => {
	const pages = htmlPaths.map((path) => read(htmlFile(path)));
	const urls = new Set(
		pages.map((html) => html.match(/<meta property="og:image" content="([^"]+)"/u)?.[1]),
	);
	assert.equal(urls.size, 1);
	const [url = ''] = urls;
	assert.match(
		url,
		/^https:\/\/bestboy\.dev\/malini\/_app\/immutable\/assets\/og\.[\w-]{8}\.png$/u,
	);
	const image = readFileSync(IMAGE);
	assert.ok(readFileSync(join(build, url.slice(SITE.length))).equals(image));
	assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1200, 630]);
	const tags = [
		/<meta property="og:image:width" content="1200"/u,
		/<meta property="og:image:height" content="630"/u,
		/<meta property="og:image:alt" content="[^"]+"/u,
		/<meta name="twitter:card" content="summary_large_image"/u,
	];
	for (const [index, html] of pages.entries()) {
		for (const tag of tags) assert.match(html, tag, htmlPaths[index]);
	}
});

test('the Open Graph view stays out of search', () => {
	const html = read('og.html');
	assert.match(html, /<meta name="robots" content="noindex"/u);
	assert.doesNotMatch(html, /rel="canonical"/u);
});

test('the hero is the only README image the site uses', () => {
	const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
		(file) =>
			!/^(node_modules|build|\.svelte-kit)\//u.test(file) &&
			/\.(ts|js|mjs|svelte|css|html|jsonc?)$/u.test(file),
	);
	assert.ok(sources.length > 10);
	for (const file of sources) {
		const images =
			readFileSync(join(root, file), 'utf8').match(/\.github\/readme\/[\w.-]+/gu) ?? [];
		for (const image of images) assert.equal(image, '.github/readme/hero.webp', file);
	}
});
