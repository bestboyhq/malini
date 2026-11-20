import type { RouteNode } from '$shared/router/hash-router.svelte';

const automationsPage = () => import('./presentation/pages/AutomationsPage.svelte');
const brainPage = () => import('./presentation/pages/BrainPage.svelte');

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
				{
					segment: 'repositories',
					children: [
						{
							segment: ':repositoryId',
							page: () => import('./presentation/pages/RepositoryPage.svelte'),
						},
					],
				},
				{
					segment: 'automations',
					page: automationsPage,
					children: [
						{ segment: 'activity', page: automationsPage },
						{ segment: 'explorer', page: automationsPage },
						{ segment: 'recipes', page: automationsPage },
						{ segment: 'routines', redirect: '/automations' },
						{
							segment: ':automationId',
							page: automationsPage,
							children: [{ segment: 'improve', page: automationsPage }],
						},
					],
				},
				{
					segment: 'brain',
					page: brainPage,
					children: [{ segment: ':path', page: brainPage }],
				},
			],
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
