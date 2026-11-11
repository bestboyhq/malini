import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installGh } from '../src/main/process/gh-install.ts';

const VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'gh');

if (process.argv[1] === fileURLToPath(import.meta.url)) await installGh(VENDOR, fetch);
