(function applyStoredTheme() {
	var mode = null;
	try {
		mode = window.localStorage.getItem('malini.settings.theme');
	} catch (error) {
		mode = null;
	}
	if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
		mode = 'system';
	}
	var dark =
		mode === 'dark' ||
		(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
	document.documentElement.setAttribute('data-native-shell', 'true');
	try {
		var zoom =
			window.malini && window.malini.windowChrome ? window.malini.windowChrome.zoomFactor() : 1;
		document.documentElement.style.setProperty('--native-zoom', String(zoom));
	} catch (error) {}
})();
