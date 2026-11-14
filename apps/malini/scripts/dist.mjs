import { build } from 'electron-builder';

await build({
	dir: true,
	config: { publish: null, mac: { identity: null, forceCodeSigning: false } },
});
