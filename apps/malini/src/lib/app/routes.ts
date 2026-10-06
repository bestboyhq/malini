import type { RouteNode } from '$shared/router/hash-router.svelte';

export const routes: RouteNode = {
	segment: '',
	children: [
		{
			segment: '',
			layout: () => import('./presentation/layouts/WorkstreamsLayout.svelte'),
			page: () => import('./presentation/pages/RepositoriesPage.svelte'),
			children: [
				{
					segment: 'workstreams',
					children: [
						{
							segment: ':workstreamId',
							layout: () => import('./presentation/layouts/WorkstreamLayout.svelte'),
							page: () => import('./presentation/pages/WorkstreamPage.svelte'),
						},
					],
				},
			],
		},
		{
			segment: 'routines',
			page: () => import('./presentation/pages/RoutinesPage.svelte'),
		},
		{
			segment: 'settings',
			page: () => import('./presentation/pages/SettingsPage.svelte'),
		},
		{
			segment: 'dev',
			children: [
				{ segment: 'runtime', page: () => import('./presentation/pages/RuntimePage.svelte') },
			],
		},
	],
};

export const notFound = () => import('./presentation/pages/NotFoundPage.svelte');
