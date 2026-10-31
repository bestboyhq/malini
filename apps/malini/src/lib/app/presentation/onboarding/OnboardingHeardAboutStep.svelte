<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BrandIcon, Icon, SmileyIcon, type Brand } from '$hyper-ui/icons';
	import { chooseHeardAboutCommand } from '$lib/app/application/commands/choose-heard-about.command';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import { HEARD_ABOUT_CHANNELS, type HeardAboutChannel } from '$lib/app/domain/heard-about';

	const LABELS: Readonly<Record<HeardAboutChannel, string>> = {
		'hacker-news': 'Hacker News',
		youtube: 'YouTube',
		twitter: 'Twitter',
		github: 'GitHub',
		reddit: 'Reddit',
		chatgpt: 'ChatGPT',
		claude: 'Claude',
		google: 'Google',
		friend: 'A friend',
		'somewhere-else': 'Somewhere else',
	};

	const BRANDS: Readonly<Partial<Record<HeardAboutChannel, Brand>>> = {
		'hacker-news': 'hacker-news',
		youtube: 'youtube',
		twitter: 'x',
		github: 'github',
		reddit: 'reddit',
		chatgpt: 'openai',
		claude: 'claude',
		google: 'google',
	};

	const answer = $derived(onboardingQuery.data.heardAbout);
	let detailField = $state<HTMLInputElement | null>(null);

	async function choose(channel: HeardAboutChannel): Promise<void> {
		chooseHeardAboutCommand({ channel, detail: answer?.detail ?? '' });
		if (channel !== 'somewhere-else') return;
		await tick();
		detailField?.focus();
	}

	function describe(): void {
		chooseHeardAboutCommand({ channel: 'somewhere-else', detail: detailField?.value ?? '' });
	}
</script>

<div class="flex flex-wrap gap-2" role="group" aria-label="Where you heard about Malini">
	{#each HEARD_ABOUT_CHANNELS as channel (channel)}
		{@const brand = BRANDS[channel]}
		{@const chosen = answer?.channel === channel}
		<Button
			variant="ghost"
			size="auto"
			radius="full"
			bordered
			active={chosen}
			ariaPressed={chosen}
			class="data-[active=true]:border-button-primary/50 h-9 pr-3 pl-[9.5px] text-base font-normal"
			onclick={() => choose(channel)}
		>
			{#snippet leading()}
				{#if brand}
					<BrandIcon {brand} />
				{:else if channel === 'friend'}
					<SmileyIcon />
				{:else}
					<Icon name="more" />
				{/if}
			{/snippet}
			{LABELS[channel]}
		</Button>
	{/each}
</div>

{#if answer?.channel === 'somewhere-else'}
	<TextInput
		class="mt-3"
		ariaLabel="Where you heard about Malini"
		placeholder="A podcast, a newsletter, a video…"
		maxlength={100}
		value={answer.detail}
		bind:element={detailField}
		oninput={describe}
	/>
{/if}
