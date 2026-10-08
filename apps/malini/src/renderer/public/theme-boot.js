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
	// ponytail: measured once at boot, so switching between overlay and classic scrollbars needs a reload
	var probe = document.createElement('div');
	probe.style.cssText =
		'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll;scrollbar-width:thin';
	document.documentElement.appendChild(probe);
	document.documentElement.style.setProperty(
		'--scrollbar-gutter',
		probe.offsetWidth - probe.clientWidth + 'px',
	);
	probe.remove();
})();
