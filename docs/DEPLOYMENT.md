# Deployment

This guide covers deploying a Pigeongram instance to Cloudflare. Each deployment owns its domain, Cloudflare account,
Telegram API credentials, Access policy, and optional Android signing key.

## What you need

- A Cloudflare account with Workers, Pages, and Durable Objects available
- A Pages domain (a custom domain is recommended for production)
- Telegram `api_id` and `api_hash` from <https://my.telegram.org> → **API development tools**
- A Cloudflare API token and account ID for GitHub Actions
- A Cloudflare Access application protecting `/user*`

The Access application must be a self-hosted application on the Pages hostname and must be path-scoped to `/user*`.
The public intro, static assets, `/api/health`, and the PWA files must remain public. Do not point Access at the Worker
directly: the application uses WebSockets, which require the Pages-to-Worker service binding.

## GitHub configuration

Set these repository secrets:

| Secret                                  | Purpose                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                  | Deploys Workers and Pages                                                                       |
| `CLOUDFLARE_ACCOUNT_ID`                 | Selects the Cloudflare account                                                                  |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Optional Telegram API credentials; CD defaults to `2496` and `8da85b0d5bfe62527e5b244c209159c3` |

Set these repository variables:

| Variable                                | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `CLOUDFLARE_PAGES_PROJECT_NAME`         | Optional Pages project name                              |
| `VITE_APP_NAME` / `VITE_APP_SHORT_NAME` | Optional product and launcher names                      |
| `WRANGLER_VARS_PATCH_JSON`              | Deployment values such as `TEAM_DOMAIN` and `POLICY_AUD` |

The Access variables are public configuration, not secrets:

```json
{
  "TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
  "POLICY_AUD": "<application-aud-tag>"
}
```

`TEAM_DOMAIN` is found in **Zero Trust → Settings**. `POLICY_AUD` is the Access application's **Application Audience
(AUD) Tag** under **Zero Trust → Access controls → Applications → the Pages application → Additional settings**.

The worker's CSRF check trusts the forwarded request's own origin, so a normal Pages-to-Worker service-binding call needs
no extra variable. `PAGES_ORIGIN` (and the comma-separated `ALLOWED_ORIGINS`) exist for a proxy that rewrites the request
URL, such as a preview deployment on a second hostname.

Continuous Deployment provisions the runtime secrets on every Worker deploy. Set repository secrets
`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` to override the defaults; otherwise CD uses `2496` and
`8da85b0d5bfe62527e5b244c209159c3`.

Never set `ACCESS_DEV_BYPASS` on a deployment. It is for local development only, and `ACCESS_DEV_EMAIL` is the
identity it authenticates as; a bypass with no address fails closed.

## First deploy

1. Configure the repository secrets and variables above.
2. Merge to `main`. Continuous Integration runs the checks and the Worker bundle validation.
3. Continuous Deployment deploys the Worker and Pages project after CI succeeds.
4. Confirm the Pages site loads publicly and `/api/health` responds.
5. Open the site and choose **Sign In With Cloudflare Access**. After Access, the app shows the Telegram QR login.
6. Monitor the Worker with `pnpm exec wrangler tail` and follow the acceptance checks in
   [the session-engine runbook](SESSION_ENGINE.md).

The Worker is intentionally not publicly routable. Pages Functions call it through the `API_WORKER` service binding.
Account routes live under `/user/*`; only `/api/health` is public.

## CI and deployment workflows

- **Continuous Integration** runs typecheck, lint, formatting, repository checks, tests, and build checks.
- **Continuous Deployment** deploys the Worker and Pages after CI succeeds on `main`.
- **Android Build** is manual and creates a deployment-specific Trusted Web Activity.
- **Backup Main Branch** is optional and mirrors the repository when its destination secrets are configured.

After the first successful CI run, configure branch protection on `main` with the required checks:
**Typecheck**, **Lint**, **Format**, **God Files**, **Dead Code**, **Unit Tests**, **Worker Bundle**, and **Build Web App**. Enable
**Allow auto-merge** if Dependabot auto-merge is wanted.

## Android app (optional)

The Android wrapper is a Trusted Web Activity for one deployment; it is not a generic Pigeongram release. Follow the
[Android runbook](ANDROID.md) to choose a package ID, create a signing key, configure asset links, deploy Pages, and run
**Actions → Android Build → Run workflow**.

Build Pages before Android so the live origin serves the correct `/.well-known/assetlinks.json`. Never share a
deployment's keystore or install an APK signed for another deployment.

## Troubleshooting

**`/user/*` returns `access_config`.** Check `TEAM_DOMAIN` and `POLICY_AUD`, then redeploy the Worker.

**Access gates the intro or asset links.** Change the Access application path from the whole hostname to `/user*`.

**The Android app shows a URL bar.** Verify that the live asset-links file returns `200` without a redirect and names
the exact package ID and signing certificate. Then reinstall the app to clear Chrome's verification cache.

For backend wake behavior, bridge methods, and production acceptance checks, see [SESSION_ENGINE.md](SESSION_ENGINE.md).
