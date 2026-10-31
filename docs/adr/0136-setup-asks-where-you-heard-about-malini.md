# 0136 - Setup asks where you heard about Malini

Status: accepted

## Context

0129 keeps the usage counts to Logdash exactly as 0058 set them: `app_active` and `run_finished`, with no properties and no user id.
The site counts visits and downloads per page (0059), but nothing links a channel to the people who then use Malini.
The user asked: "I cannot answer a question which channel brings the most usage", and wants to know, for example, whether people from Hacker News claim their profile.
Following a person from a link to the app would take a cookie or an install id, which 0031 and 0058 rule out.
Asking once in setup needs neither, and catches word of mouth that no link can.

## Decision

- Setup gets a fourth step, before **Open your first repository**: **Where did you hear about Malini?**
  It offers Hacker News, YouTube, Twitter, GitHub, Reddit, ChatGPT, Claude, Google, **A friend** and **Somewhere else**, each with its logo, and **Somewhere else** opens a field for where.
  **Continue** waits for a pick; **Skip** moves on.
- The answer lives in the `heard-about` setting, from `src/lib/app/domain/heard-about.ts`: a channel id, or what you typed for **Somewhere else** with `@` and control characters dropped, cut to 100 characters.
  **Skip** stores an empty value, which forgets an earlier answer.
- Every usage count carries the answer as Logdash `props`: `heard_about` with the channel id, and `heard_about_detail` with what you typed for **Somewhere else**.
  A count before you answer, or after you skip, carries no props.
- A third count, `malini_desktop_profile_published`, fires when you claim your `@handle` and **Publish my stats** turns on.
  It follows the new `stats:profile-published` event, which `StatsProfile.publish` emits with your Bestboy profile once the platform accepts it.
- **Share usage data**, `MALINI_USAGE_DATA=off` and `DO_NOT_TRACK=1` still stop every count, the answer included.
- The logos are `BrandIcon` and `SmileyIcon` in `packages/hyper-ui/src/icons`, the one place literal brand colors may live.

## Consequences

- Logdash answers which channel brings the most active days, runs and published profiles, without an id or a cookie.
- The answer is what people say, not what a link proves, and Malini installs that finished setup before this change never get asked.
- The detail is free text the person typed, so it can name anything; the `@` filter keeps emails and handles out, as Logdash's own web SDK does.
- A new channel is a new id in `HEARD_ABOUT_CHANNELS`; Logdash reports read old ids as they were.
- Enforced by `src/lib/app/domain/heard-about.test.ts` (the stored value, the filtered detail, no props before an answer or after a skip), `src/lib/app/platform/usage-data.test.ts` (each count tagged, the published count, nothing once usage data is off), `src/lib/stats/platform/stats-profile.test.ts` (the event fires once on publish), and `tests/e2e/first-run.spec.ts` (pick, type, continue, back, skip).
