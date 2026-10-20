import { describe, expect, it } from 'vitest';
import { containerWorkstream, dockerRunning, parseDockerInspect } from './running-docker';

const WORKSTREAMS = [
	{ id: 'ws-shop', path: '/Users/me/malini/workstreams/ws-shop' },
	{ id: 'ws-blog', path: '/Users/me/malini/workstreams/ws-blog' },
];

function container(
	id: string,
	labels: Record<string, string>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Id: id,
		Name: `/${labels['com.docker.compose.project'] ?? 'plain'}-${labels['com.docker.compose.service'] ?? id}-1`,
		State: { Status: 'running', Running: true, StartedAt: '2026-10-19T09:15:30.123456789Z' },
		Config: { Image: `${id}:latest`, Labels: labels },
		NetworkSettings: { Ports: {} },
		...extra,
	};
}

function compose(service: string, dependsOn = ''): Record<string, string> {
	return {
		'com.docker.compose.project': 'shop',
		'com.docker.compose.service': service,
		'com.docker.compose.project.working_dir': '/Users/me/malini/workstreams/ws-shop/infra',
		'com.docker.compose.depends_on': dependsOn,
	};
}

const INSPECT = JSON.stringify([
	container('a1', compose('api', 'db:service_healthy:false,cache:service_started:true'), {
		NetworkSettings: {
			Ports: {
				'3000/tcp': [
					{ HostIp: '0.0.0.0', HostPort: '3000' },
					{ HostIp: '::', HostPort: '3000' },
				],
				'9229/tcp': null,
			},
		},
	}),
	container('d1', compose('db'), {
		NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] } },
	}),
	container('c1', compose('cache')),
	container('s1', compose('studio', 'db:service_started:false')),
	container('m1', { 'app.malini.workstream': 'ws-blog' }),
	container('f1', {
		'com.docker.compose.project': 'ws-blog',
		'com.docker.compose.service': 'site',
		'com.docker.compose.project.working_dir': '/Users/me/malini/workstreams/ws-blog',
	}),
	container('x1', {
		'com.docker.compose.project.working_dir': '/Users/me/malini/workstreams/ws-shopping',
	}),
	container('o1', {}, { State: { Running: false, StartedAt: '2026-10-19T09:15:30Z' } }),
	{ Id: 42 },
	'not a container',
]);

describe('running docker', () => {
	it('reads running containers from docker inspect and skips malformed entries', () => {
		const containers = parseDockerInspect(INSPECT);

		expect(containers.map((entry) => entry.id)).toEqual(['a1', 'd1', 'c1', 's1', 'm1', 'f1', 'x1']);
		expect(containers[0]).toEqual({
			id: 'a1',
			name: 'shop-api-1',
			image: 'a1:latest',
			startedAt: Date.parse('2026-10-19T09:15:30.123Z'),
			ports: [3000],
			labels: compose('api', 'db:service_healthy:false,cache:service_started:true'),
		});
		expect(parseDockerInspect('not json')).toEqual([]);
		expect(parseDockerInspect('{"Id":"a1"}')).toEqual([]);
	});

	it('matches a container to a workstream by its label or its compose folder', () => {
		const [api, , , , labelled, , sibling] = parseDockerInspect(INSPECT);
		if (!api || !labelled || !sibling) throw new Error('the fixture lost a container');

		expect(containerWorkstream(api, WORKSTREAMS)).toBe('ws-shop');
		expect(containerWorkstream(labelled, WORKSTREAMS)).toBe('ws-blog');
		expect(containerWorkstream(sibling, WORKSTREAMS)).toBeNull();
	});

	it('folds the services others depend on behind the ones that use them', () => {
		const running = dockerRunning(parseDockerInspect(INSPECT), WORKSTREAMS);

		expect([...running.keys()]).toEqual(['ws-shop', 'ws-blog']);
		const shop = running.get('ws-shop');
		expect(shop?.behind).toEqual(['cache', 'db']);
		expect(shop?.items).toEqual([
			{
				id: 'docker:a1',
				origin: 'docker',
				name: 'api',
				kind: 'service',
				detail: 'a1:latest',
				group: 'shop',
				startedAt: Date.parse('2026-10-19T09:15:30.123Z'),
				ports: [3000],
			},
			expect.objectContaining({ id: 'docker:s1', name: 'studio', group: 'shop' }),
		]);
		expect(running.get('ws-blog')?.items).toEqual([
			expect.objectContaining({ id: 'docker:m1', name: 'plain-m1-1', group: null }),
			expect.objectContaining({ id: 'docker:f1', name: 'site', group: null }),
		]);
	});
});
