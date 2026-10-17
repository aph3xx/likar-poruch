# PostHog analytics setup

The site has a browser analytics component at `src/components/PostHogAnalytics.astro`, the official `posthog-js` dependency is installed, and the single shared Ukrainian layout at `src/layouts/BaseLayout.astro` renders the component for every page. It only initializes when `PUBLIC_POSTHOG_KEY` is present. Until a real PostHog project key is configured, the deployed site remains intentionally analytics-disabled.

## Privacy defaults

The component:

- respects browser Do Not Track and does not initialize when DNT is enabled;
- creates person profiles only for identified users (`person_profiles: 'identified_only'`);
- captures page views and page leaves;
- disables session recording and automatic element autocapture;
- uses PostHog cookieless mode and therefore requires cookieless ingestion to be enabled in the PostHog project settings;
- listens for `likar:booking_started` and `likar:booking_submitted` browser `CustomEvent`s;
- records those as `booking_started` and `booking_submitted` without forwarding `CustomEvent.detail` or any name, phone number, or other form value.

Do not add patient, health, contact, or free-text data to PostHog event properties.

## Application integration

The SDK is installed, the component is mounted once in the shared Ukrainian layout, and GitHub Actions passes the two repository variables to both `astro check` and the CI build. No additional source-code integration is required.

## Environment variables

Astro exposes variables prefixed with `PUBLIC_` to browser code at build time.

| Variable | Required | Value |
| --- | --- | --- |
| `PUBLIC_POSTHOG_KEY` | Yes, to enable analytics | The PostHog **project key/token** from the project's setup page (usually starts with `phc_`). |
| `PUBLIC_POSTHOG_HOST` | No | PostHog ingestion host. Defaults to the EU host, `https://eu.i.posthog.com`. Set it explicitly if the project uses another region or a reverse proxy. |

The PostHog project key is designed to be public and will be embedded in the generated JavaScript. It is not a PostHog personal API key and must not be replaced with one. Even though it is public, manage it as deployment configuration rather than hard-coding it in source.

For local development, put the values in an uncommitted `.env` file:

```dotenv
PUBLIC_POSTHOG_KEY=phc_your_project_key
PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

## GitHub Actions configuration

In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and create:

- `PUBLIC_POSTHOG_KEY` — required for analytics;
- `PUBLIC_POSTHOG_HOST` — optional because the component has the EU default.

The CI workflow/build step must pass repository variables to the Astro build step or job:

```yaml
env:
  PUBLIC_POSTHOG_KEY: ${{ vars.PUBLIC_POSTHOG_KEY }}
  PUBLIC_POSTHOG_HOST: ${{ vars.PUBLIC_POSTHOG_HOST }}
```

A GitHub Actions secret is not required for the public project key. If repository policy requires storing it under **Actions secrets**, use `secrets.PUBLIC_POSTHOG_KEY` in the workflow instead of `vars.PUBLIC_POSTHOG_KEY`. Never expose a PostHog personal API key, organization API key, or other private credential through a `PUBLIC_` variable.

Astro substitutes these values during `npm run build`, so changing an Actions variable or secret requires a new deployment.

## Dispatching booking events

The component deliberately ignores all event payloads. Existing booking UI can announce milestones without exposing form values:

```js
window.dispatchEvent(new CustomEvent('likar:booking_started'));
window.dispatchEvent(new CustomEvent('likar:booking_submitted'));
```

Do not attach names, phone numbers, symptoms, or other personal/medical information in `detail`.

## Verification in PostHog

After the SDK is installed, the component is mounted, a real project key is configured, and the private SUR site is redeployed from a clean `main` checkout with `npm run deploy:sur`:

1. In PostHog, open the correct project and go to **Activity → Live Events**.
2. Open the deployed site in a browser where Do Not Track is off and disable content blockers for the test if necessary.
3. Navigate between pages and confirm a `$pageview` event arrives.
4. Trigger the booking UI and confirm `booking_started` and `booking_submitted` arrive.
5. Inspect each booking event's properties and confirm no name, phone number, form values, or medical details are present.
6. Confirm no session recordings are created.

If no events appear, verify the deployed build received `PUBLIC_POSTHOG_KEY`, check that `PUBLIC_POSTHOG_HOST` matches the project's region, and inspect the browser console/network requests. An absent key intentionally produces no PostHog initialization or events.
