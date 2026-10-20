export async function settleConcurrentSessionPreparation<T>(
	tasks: readonly (() => Promise<T>)[],
): Promise<readonly T[]> {
	const settled = await Promise.allSettled(
		tasks.map(async (task) => {
			return await task();
		}),
	);
	const rejection = settled.find(
		(result): result is PromiseRejectedResult => result.status === 'rejected',
	);
	if (rejection) throw rejection.reason;
	return settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
}
