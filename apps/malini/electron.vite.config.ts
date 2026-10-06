import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { thirdPartyNotices } from './scripts/third-party-notices.mjs';

const hyperUi = fileURLToPath(new URL('../../packages/hyper-ui/src', import.meta.url));
const mainSrc = fileURLToPath(new URL('./src/main', import.meta.url));
const libSrc = fileURLToPath(new URL('./src/lib', import.meta.url));
const sharedSrc = fileURLToPath(new URL('./src/lib/shared', import.meta.url));
const contractSrc = fileURLToPath(new URL('./src/contract', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const rendererPort = Number(process.env['MALINI_RENDERER_PORT']) || undefined;
const agentBridgeSourceRoots = ['src', 'protocol'].map((dir) =>
	fileURLToPath(new URL(`../../packages/agent-bridge/${dir}/`, import.meta.url)),
);

function agentBridgeSourceFiles(): string[] {
	return agentBridgeSourceRoots.flatMap((root) =>
		readdirSync(root, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.(ts|json)$/.test(file) && !file.endsWith('.test.ts'))
			.filter((file) => !file.startsWith(`generated${sep}`))
			.map((file) => join(root, file)),
	);
}

function rebuildAgentBridgeOnChange(): Plugin {
	let stale = true;
	return {
		name: 'malini:rebuild-agent-bridge-on-change',
		buildStart() {
			if (!this.meta.watchMode) return;
			for (const file of agentBridgeSourceFiles()) this.addWatchFile(file);
			if (!stale) return;
			try {
				execFileSync('pnpm', ['--filter', '@malini/agent-bridge', 'build'], {
					cwd: workspaceRoot,
					stdio: 'inherit',
				});
				stale = false;
			} catch {
				this.warn('agent bridge build failed; the next change to its source retries it');
			}
		},
		watchChange(id) {
			if (agentBridgeSourceRoots.some((root) => id.startsWith(root))) stale = true;
		},
	};
}

const nodeAlias = {
	$main: mainSrc,
	$lib: libSrc,
	$shared: sharedSrc,
	$contract: contractSrc,
};

export default defineConfig({
	main: {
		plugins: [rebuildAgentBridgeOnChange(), thirdPartyNotices()],
		resolve: { alias: nodeAlias },
		build: {
			target: 'node24',
			rollupOptions: { input: { index: 'src/main/index.ts' } },
		},
	},
	preload: {
		plugins: [thirdPartyNotices()],
		resolve: { alias: { $contract: contractSrc } },
		build: {
			target: 'node24',
			rollupOptions: { input: { index: 'src/preload/index.ts' } },
		},
	},
	renderer: {
		plugins: [tailwindcss(), svelte(), thirdPartyNotices()],
		resolve: {
			alias: {
				'$hyper-ui': hyperUi,
				$lib: libSrc,
				$shared: sharedSrc,
				$contract: contractSrc,
			},
		},
		server: {
			fs: { allow: [workspaceRoot] },
			...(rendererPort ? { port: rendererPort, strictPort: true } : {}),
		},
	},
});
