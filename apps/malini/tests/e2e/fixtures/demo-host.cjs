const { app, BrowserWindow } = require('electron');

app.dock?.hide();
let host;
app.once('ready', () => {
	host = new BrowserWindow({
		width: 1280,
		height: 860,
		show: false,
		useContentSize: true,
		webPreferences: { offscreen: true, backgroundThrottling: false },
	});
	void host.loadURL('about:blank');
});
