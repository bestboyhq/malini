<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BrandIcon, Icon, SmileyIcon, type Brand } from '$hyper-ui/icons';
	import { answerHeardAboutCommand } from '$lib/app/application/commands/answer-heard-about.command';
	import { chooseHeardAboutCommand } from '$lib/app/application/commands/choose-heard-about.command';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import {
		HEARD_ABOUT_CHANNELS,
		heardAboutDetail,
		type HeardAboutChannel,
	} from '$lib/app/domain/heard-about';

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

	const onboarding = $derived(onboardingQuery.data);
	const answer = $derived(onboarding.heardAbout);
	const describing = $derived(answer?.channel === 'somewhere-else' && !onboarding.heardAboutSent);
	let detail = $state('');
	let detailField = $state<HTMLInputElement | null>(null);

	async function choose(channel: HeardAboutChannel): Promise<void> {
		if (channel !== 'somewhere-else') {
			answerHeardAboutCommand({ channel, detail: '' });
			return;
		}
		chooseHeardAboutCommand({ channel, detail });
		await tick();
		detailField?.focus();
	}

	function send(event: SubmitEvent): void {
		event.preventDefault();
		answerHeardAboutCommand({ channel: 'somewhere-else', detail: heardAboutDetail(detail) });
	}
</script>

{#if onboarding.firstMerge && (onboarding.heardAboutUnanswered || onboarding.heardAboutSent)}
	<section
		class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
		aria-labelledby="heard-about-title"
		data-testid="heard-about-card"
	>
		<header class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<h2 id="heard-about-title" class="text-fg-default text-sm font-medium">
					First merge. Where did you hear about Malini?
				</h2>
				<p class="text-fg-tertiary text-xs leading-5" role="status">
					{onboarding.heardAboutSent
						? 'Noted. Thanks'
						: 'One click. It tells us where to post next'}
				</p>
			</div>
			{#if !onboarding.heardAboutSent}
				<IconButton
					variant="ghost"
					size="sm"
					class="text-fg-tertiary -mt-0.5 -mr-1.5"
					ariaLabel="Dismiss where you heard about Malini"
					onclick={() => answerHeardAboutCommand(null)}
				>
					<Icon name="close" size={14} />
				</IconButton>
			{/if}
		</header>
		{#if !onboarding.heardAboutSent}
			<div
				class="mt-3 flex flex-wrap gap-1.5"
				role="group"
				aria-label="Where you heard about Malini"
			>
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
						class="data-[active=true]:border-button-primary/50 h-8 pr-3 pl-2 text-sm font-normal"
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
			{#if describing}
				<form class="mt-3 flex items-center gap-2" onsubmit={send}>
					<TextInput
						class="min-w-0 flex-1"
						ariaLabel="Where you heard about Malini"
						placeholder="A podcast, a newsletter, a video…"
						maxlength={100}
						bind:value={detail}
						bind:element={detailField}
					/>
					<Button type="submit" variant="primary" size="sm" disabled={detail.trim().length === 0}>
						Send
					</Button>
				</form>
			{/if}
		{/if}
	</section>
{/if}
