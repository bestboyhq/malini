import { trySpawnDetached } from '$main/process/detached';

export interface CheckoutShell {
	reveal(path: string): Promise<void>;
	openInEditor(path: string): Promise<void>;
}

export const defaultCheckoutShell: CheckoutShell = {
	async reveal(path) {
		const result = await trySpawnDetached('open', [path]);
		if (!result.launched) throw new Error(`open failed: ${result.error ?? 'unknown error'}`);
	},
	async openInEditor(path) {
		const home = process.env.HOME ?? '';
		const inherited = process.env.PATH ?? '';
		const augmented = `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${inherited}`;
		const code = await trySpawnDetached('code', [path], { PATH: augmented });
		if (code.launched) return;
		const result = await trySpawnDetached('open', [path]);
		if (!result.launched) throw new Error(`open failed: ${result.error ?? 'unknown error'}`);
	},
};
