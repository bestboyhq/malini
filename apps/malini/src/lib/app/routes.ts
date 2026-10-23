import type { RouteNode } from '$shared/router/hash-router.svelte';

const jobsPage = () => import('./presentation/pages/JobsPage.svelte');

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
					segment: 'jobs',
					page: jobsPage,
					children: [
						{ segment: 'activity', page: jobsPage },
						{ segment: 'recipes', page: jobsPage },
						{ segment: 'routines', redirect: '/jobs' },
						{ segment: ':jobId', page: jobsPage },
					],
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
