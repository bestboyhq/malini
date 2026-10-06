<script lang="ts">
	import { page } from '$shared/router/state';
</script>

<main data-testid="fixture-page" data-route-id={page.route.id}>
	{JSON.stringify(page.params)}
	<a href="/items/second" data-testid="fixture-link">second</a>
	<a href="https://example.test/docs" data-testid="fixture-external">docs</a>
</main>
