import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghBuild, installGh } from '../src/main/process/gh-install.ts';

const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'gh');
const BUILDER_OS =
	process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const arch of ['arm64', 'x64']) {
		await installGh(join(VENDOR, `${BUILDER_OS}-${arch}`), fetch, {
			build: ghBuild(process.platform, arch),
		});
	}
}
