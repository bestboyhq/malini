import { isRecord } from '$main/db/rows';

const ACCESS = ['pull', 'triage', 'push', 'maintain', 'admin'] as const;

export type GithubAccess = (typeof ACCESS)[number];

export type Invitation = Readonly<{ id: number; login: string }>;

export type AccessChanges = Readonly<{
	grant: readonly Readonly<{ login: string; access: GithubAccess }>[];
	remove: readonly string[];
	cancel: readonly number[];
}>;

const PLAN_REPOSITORY_SUFFIX = '-malini-plan';

const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;

const NOREPLY_LOGIN = /^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/iu;

export function isGithubRepository(fullName: string): boolean {
	return GITHUB_REPOSITORY.test(fullName) && !fullName.endsWith('/..') && !fullName.endsWith('/.');
}

export function planRepositoryOf(repositoryFullName: string): string {
	return `${repositoryFullName}${PLAN_REPOSITORY_SUFFIX}`;
}

export function loginOfEmail(email: string): string | null {
	return NOREPLY_LOGIN.exec(email)?.[1] ?? null;
}

export function collaboratorAccess(raw: readonly unknown[]): Map<string, GithubAccess> {
	return new Map(
		raw.flatMap((item) => {
			const name = login(item);
			const permissions = isRecord(item) ? item['permissions'] : undefined;
			const access = isRecord(permissions)
				? [...ACCESS].reverse().find((level) => permissions[level] === true)
				: undefined;
			return name === null || access === undefined ? [] : [[name.toLowerCase(), access] as const];
		}),
	);
}

export function invitations(raw: readonly unknown[]): Invitation[] {
	return raw.flatMap((item) => {
		const name = isRecord(item) ? login(item['invitee']) : null;
		const id = isRecord(item) ? item['id'] : undefined;
		return name === null || typeof id !== 'number' || !Number.isInteger(id)
			? []
			: [{ id, login: name.toLowerCase() }];
	});
}

export function accessChanges(
	people: Readonly<{
		source: ReadonlyMap<string, GithubAccess>;
		granted: ReadonlyMap<string, GithubAccess>;
		direct: ReadonlyMap<string, GithubAccess>;
		pending: readonly Invitation[];
		keep: readonly string[];
	}>,
): AccessChanges {
	const kept = new Set(people.keep.map((name) => name.toLowerCase()));
	const invited = new Set(people.pending.map(({ login: name }) => name));
	const rank = (access: GithubAccess | undefined): number =>
		access === undefined ? -1 : ACCESS.indexOf(access);
	return {
		grant: [...people.source]
			.filter(
				([name, access]) =>
					!kept.has(name) && !invited.has(name) && rank(people.granted.get(name)) < rank(access),
			)
			.map(([name, access]) => ({ login: name, access })),
		remove: [...people.direct.keys()].filter((name) => !kept.has(name) && !people.source.has(name)),
		cancel: people.pending
			.filter(({ login: name }) => !people.source.has(name))
			.map(({ id }) => id),
	};
}

function login(value: unknown): string | null {
	return isRecord(value) && typeof value['login'] === 'string' ? value['login'] : null;
}
