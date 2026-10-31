<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { EXTENSIONS_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';

	const current = $derived(page.url.pathname.startsWith(EXTENSIONS_HREF));
</script>

<Tooltip content="Extensions" placement="right">
	<IconButton
		variant="ghost"
		size="sm"
		href={EXTENSIONS_HREF}
		ariaLabel="Extensions"
		active={current}
		{...current ? { ariaCurrent: 'page' as const } : {}}
		data-testid="sidebar-open-extensions"
	>
		<Icon name="grid-plus" size={15} />
	</IconButton>
</Tooltip>
