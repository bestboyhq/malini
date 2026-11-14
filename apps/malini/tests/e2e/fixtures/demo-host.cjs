const { app, BrowserWindow } = require('electron');

const LANDING_PAGE_FRAME = { width: 1280, height: 860 };
const LARGER_THAN_ANY_SCREEN = 16_384;

function growPastTheScreenWindowsFitItTo(window) {
	window.setContentSize(LANDING_PAGE_FRAME.width, LANDING_PAGE_FRAME.height);
}

app.dock?.hide();
let host;
app.once('ready', () => {
	host = new BrowserWindow({
		...LANDING_PAGE_FRAME,
		maxWidth: LARGER_THAN_ANY_SCREEN,
		maxHeight: LARGER_THAN_ANY_SCREEN,
		enableLargerThanScreen: true,
		show: false,
		useContentSize: true,
		webPreferences: { offscreen: true, backgroundThrottling: false },
	});
	growPastTheScreenWindowsFitItTo(host);
	void host.loadURL('about:blank');
});
