import { join } from 'node:path';

export interface NamedApp {
	getName(): string;
	setName(name: string): void;
	getPath(name: 'appData'): string;
	setPath(name: 'userData', path: string): void;
	prependOnceListener(event: 'will-finish-launching', listener: () => void): unknown;
	readonly commandLine: { hasSwitch(name: string): boolean };
}

export function pinStorageName(app: NamedApp): string {
	const productName = app.getName();
	const storageName = productName.toLowerCase();
	app.setName(storageName);
	if (!app.commandLine.hasSwitch('user-data-dir')) {
		app.setPath('userData', join(app.getPath('appData'), storageName));
	}
	app.prependOnceListener('will-finish-launching', () => app.setName(productName));
	return productName;
}
