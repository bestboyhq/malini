import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { DEVELOPMENT_BUNDLE_IDENTIFIER } from '../src/lib/app/platform/runtime-identity.ts';

const BUNDLE = 'Malini.app';
const EXECUTABLE = `${BUNDLE}/Contents/MacOS/Electron`;
const STAMP = `${BUNDLE}.stamp`;
const ICON_SIZES = [16, 32, 128, 256, 512];
const LSREGISTER =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const icon = resolve(import.meta.dirname, '../build/icon.png');

/**
 * @param {string} dist
 * @param {string} iconPath
 */
export function bundleStamp(dist, iconPath) {
	const version = readFileSync(join(dist, 'version'), 'utf8').trim();
	const iconHash = createHash('sha256').update(readFileSync(iconPath)).digest('hex');
	return `${version} ${DEVELOPMENT_BUNDLE_IDENTIFIER} ${iconHash}\n`;
}

/**
 * @param {string} dist
 * @param {string} stamp
 */
export function isStale(dist, stamp) {
	if (!existsSync(join(dist, EXECUTABLE)) || !existsSync(join(dist, STAMP))) return true;
	return readFileSync(join(dist, STAMP), 'utf8') !== stamp;
}

/**
 * @param {string} command
 * @param {string[]} args
 */
const run = (command, ...args) => execFileSync(command, args, { stdio: 'pipe' });

/**
 * @param {string} dist
 * @param {string} stamp
 */
function buildBundle(dist, stamp) {
	const bundle = join(dist, BUNDLE);
	const iconset = join(dist, 'Malini.iconset');
	const plist = join(bundle, 'Contents/Info.plist');
	rmSync(join(dist, STAMP), { force: true });
	rmSync(bundle, { recursive: true, force: true });
	rmSync(iconset, { recursive: true, force: true });
	run('cp', '-Rc', join(dist, 'Electron.app'), bundle);
	run('plutil', '-replace', 'CFBundleName', '-string', 'Malini', plist);
	run('plutil', '-replace', 'CFBundleDisplayName', '-string', 'Malini', plist);
	run('plutil', '-replace', 'CFBundleIdentifier', '-string', DEVELOPMENT_BUNDLE_IDENTIFIER, plist);
	mkdirSync(iconset);
	for (const size of ICON_SIZES) {
		const name = `icon_${size}x${size}`;
		run('sips', '-z', `${size}`, `${size}`, icon, '--out', join(iconset, `${name}.png`));
		run('sips', '-z', `${size * 2}`, `${size * 2}`, icon, '--out', join(iconset, `${name}@2x.png`));
	}
	run('iconutil', '-c', 'icns', '-o', join(bundle, 'Contents/Resources/electron.icns'), iconset);
	rmSync(iconset, { recursive: true });
	run('codesign', '--force', '--sign', '-', bundle);
	run(LSREGISTER, '-f', bundle);
	writeFileSync(join(dist, STAMP), stamp);
}

function devBundleExecutable() {
	const dist = join(
		dirname(createRequire(import.meta.url).resolve('electron/package.json')),
		'dist',
	);
	const stamp = bundleStamp(dist, icon);
	if (isStale(dist, stamp)) {
		console.log(`dev-bundle: building ${BUNDLE} in ${dist}`);
		buildBundle(dist, stamp);
	}
	return join(dist, EXECUTABLE);
}

if (import.meta.main) {
	const [command = '', ...args] = process.argv.slice(2);
	const env =
		process.platform === 'darwin'
			? { ...process.env, ELECTRON_EXEC_PATH: devBundleExecutable() }
			: process.env;
	spawn(command, args, { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 1));
}
