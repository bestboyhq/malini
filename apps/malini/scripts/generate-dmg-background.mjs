import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const BUILD = join(import.meta.dirname, '..', 'build');
const SIZE = { width: 540, height: 380 };
const SETTLED = `document.fonts.ready.then(() => {
	if (!document.fonts.check('27px "Inter Variable"')) throw new Error('Inter never loaded');
	return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})`;

async function main() {
	app.dock?.hide();
	try {
		await app.whenReady();
		const window = new BrowserWindow({
			width: SIZE.width * 2,
			height: SIZE.height * 2,
			show: false,
			useContentSize: true,
			webPreferences: { offscreen: true, zoomFactor: 2 },
		});
		await window.loadFile(join(BUILD, 'background.html'));
		await window.webContents.executeJavaScript(SETTLED);
		const retina = await window.webContents.capturePage();
		const { width, height } = retina.getSize();
		if (width !== SIZE.width * 2 || height !== SIZE.height * 2) {
			throw new Error(`the background rendered at ${width}x${height}`);
		}
		writeFileSync(join(BUILD, 'background@2x.png'), retina.toPNG());
		writeFileSync(
			join(BUILD, 'background.png'),
			retina.resize({ ...SIZE, quality: 'best' }).toPNG(),
		);
		console.log('Rendered build/background.png and build/background@2x.png');
		app.quit();
	} catch (error) {
		console.error(error);
		app.exit(1);
	}
}

void main();
