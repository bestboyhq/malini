import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { pinStorageName, type NamedApp } from './storage-name';

const APP_DATA = '/Users/me/Library/Application Support';

function fakeApp(productName: string, argv: readonly string[] = []) {
	const events = new EventEmitter();
	let name = productName;
	const paths = new Map<string, string>();
	const app: NamedApp = {
		getName: () => name,
		setName: (next) => {
			name = next;
		},
		getPath: () => APP_DATA,
		setPath: (key, path) => {
			paths.set(key, path);
		},
		prependOnceListener: (event, listener) => events.prependOnceListener(event, listener),
		commandLine: { hasSwitch: (key) => argv.some((arg) => arg.startsWith(`--${key}=`)) },
	};
	return { app, events, paths, name: () => name };
}

it.each(['Malini', 'malini'])(
	'keeps the data folder and keychain item of %s at malini, and names the default menu after it',
	(productName) => {
		const { app, events, paths, name } = fakeApp(productName);
		let defaultMenuName = '';
		events.once('will-finish-launching', () => {
			defaultMenuName = name();
		});

		expect(pinStorageName(app)).toBe(productName);
		expect(name()).toBe('malini');
		expect(paths.get('userData')).toBe(`${APP_DATA}/malini`);

		events.emit('will-finish-launching');
		expect(defaultMenuName).toBe(productName);
		expect(name()).toBe(productName);
	},
);

it('leaves a --user-data-dir profile alone', () => {
	const { app, paths } = fakeApp('Malini', ['--user-data-dir=/tmp/sandbox']);

	pinStorageName(app);

	expect(paths.has('userData')).toBe(false);
});
