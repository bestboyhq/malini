import { describe, expect, it } from 'vitest';
import {
	changelogStart,
	linkAddress,
	projectDays,
	projectIndexOfField,
	projectLink,
} from './projects';

describe('project links', () => {
	it('takes a public web address and assumes https', () => {
		expect(projectLink(' garden-wars.io ')).toEqual({
			link: 'https://garden-wars.io',
			problem: null,
		});
		expect(projectLink('http://play.garden-wars.io/demo').link).toBe(
			'http://play.garden-wars.io/demo',
		);
		expect(projectLink('https://bücher.de').problem).toBeNull();
	});

	it('refuses what the platform refuses', () => {
		expect(projectLink('').problem).toBe('Needs its link');
		expect(projectLink('ftp://garden-wars.io').problem).toBe('Not a web address');
		expect(projectLink('https://me:secret@garden-wars.io').problem).toBe('Takes no password');
		expect(projectLink('garden-wars.io:8080').problem).toBe('Takes no port');
		expect(projectLink('https://garden-wars.io:443').problem).toBe('Takes no port');
		expect(projectLink('http://192.168.1.4').problem).toBe(
			'Needs a domain name, not an IP address',
		);
		expect(projectLink('http://[::1]/').problem).toBe('Needs a domain name, not an IP address');
		for (const host of ['localhost', 'garden.local', 'garden.internal', 'garden.onion', 'a..io']) {
			expect(projectLink(host).problem).toBe('Needs a public domain name');
		}
		expect(projectLink(`garden-wars.io/${'a'.repeat(300)}`).problem).toBe(
			'Too long, 300 characters at most',
		);
	});

	it('matches a project by host without www and path without its closing slash', () => {
		expect(linkAddress('https://www.Garden-Wars.io/play/?ref=1#top')).toBe('garden-wars.io/play');
		expect(linkAddress('http://garden-wars.io')).toBe('garden-wars.io');
	});
});

describe('project days', () => {
	it('counts complete local days through yesterday, oldest first', () => {
		const cutoff = new Date(2026, 10, 12);
		const at = (day: number, hour: number): string => new Date(2026, 10, day, hour).toISOString();
		expect(
			projectDays(
				[at(11, 9), at(10, 23), at(11, 1), at(12, 0), new Date(2025, 10, 5).toISOString()],
				cutoff,
			),
		).toEqual([
			{ date: '2026-11-10', runs: 1 },
			{ date: '2026-11-11', runs: 2 },
		]);
		expect(
			projectDays(
				Array.from({ length: 3_001 }, () => at(11, 9)),
				cutoff,
			),
		).toEqual([{ date: '2026-11-11', runs: 3_000 }]);
	});
});

describe('changelog start', () => {
	it('sends a short file whole and cuts a long one at a line end within 32 KB', () => {
		expect(changelogStart('## 2026-11-05\n')).toBe('## 2026-11-05\n');
		expect(changelogStart('  \n')).toBeNull();
		const line = `- **Note.** ${'ł'.repeat(40)}\n`;
		const cut = changelogStart(line.repeat(1_000)) ?? '';
		expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(32 * 1024);
		expect(cut.endsWith('\n')).toBe(true);
		expect(cut.length % line.length).toBe(0);
		expect(changelogStart('a'.repeat(40_000))).toBeNull();
	});

	it('reads the project a refusal names', () => {
		expect(projectIndexOfField('projects[2].days[3].runs')).toBe(2);
		expect(projectIndexOfField('version')).toBeNull();
		expect(projectIndexOfField(null)).toBeNull();
	});
});
