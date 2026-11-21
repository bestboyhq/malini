export type CheckoutFixCase = Readonly<{
	folder: string;
	repository: string | null;
	branch: string;
	said: string | null;
}>;

export function checkoutFixPrompt({ folder, repository, branch, said }: CheckoutFixCase): string {
	const status = `git -C "${folder}" status`;
	return [
		"Git cannot read this workstream's checkout. Make it work again.",
		'',
		`- Checkout: \`${folder}\``,
		`- Base repository, which holds its commits: ${repository === null ? 'unknown' : `\`${repository}\``}`,
		`- Branch: \`${branch}\``,
		said === null
			? `- Git gave no reason. Run \`${status}\` to see what it says.`
			: `- Git says: \`${said}\``,
		'',
		'Keep every file and every uncommitted change in the checkout. Never reset, clean, stash or check out over them, and copy anything before you move it.',
		'Stay on the branch. Do not commit or push.',
		`Stop once \`${status}\` works, and say in one line what was broken and what you changed.`,
	].join('\n');
}
