import { handleClaimsStore } from '$lib/extensions/infrastructure/stores/handle-claims.store.svelte';

export { handleClaimQuery };

type HandleClaim = Readonly<{ claiming: boolean; problem: string | null }>;

class HandleClaimQuery {
	public readonly data: HandleClaim = $derived({
		claiming: handleClaimsStore.claiming,
		problem: handleClaimsStore.problem,
	});
}

const handleClaimQuery = new HandleClaimQuery();
