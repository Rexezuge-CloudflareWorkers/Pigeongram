# The Android app

The SPA can also be shipped as a **Trusted Web Activity (TWA)**: a thin Android shell that opens the deployed origin in
the user's browser. There is no bundled web code. This is the runbook for building one **per deployment**.

## Why every deployment builds its own

A TWA is not a generic browser. Its manifest bakes in the host, the Android package id and the signing key, and Chrome
only hides the URL bar when the origin serves a Digital Asset Links statement that names the package and the certificate.
Those values belong to one deployment:

- A package id is unique on a device. Two deployments that reuse one collide at install time.
- A signing key is the update authority. An APK signed by somebody else cannot be trusted with your Telegram session.
- The origin receives the Access login and the account traffic. An upstream-signed APK points at the upstream origin.

So this repository does **not** publish a signed APK for everyone. Each deployment forks the repository, sets its own
variables and secrets, and runs **Actions → Android Build → Run workflow**. The workflow uploads the APK, the AAB and
`SHA256SUMS` as run artifacts; it does not attach them to a release and does not need `contents: write`.

## What requires a rebuild

| Change                                                    | Rebuild the Android app?                         |
| --------------------------------------------------------- | ------------------------------------------------ |
| Web UI, API, service worker, chats, calls, uploads        | No — the shell loads the live origin             |
| App name, launcher name, launcher icon, theme colours     | Yes — baked into the APK                         |
| Deployment origin or host                                 | Yes — the host is compiled into the TWA manifest |
| Package id                                                | Yes — and it is effectively a new app            |
| Signing key                                               | Yes — an update must be signed by the same key   |
| Bubblewrap, AGP, target SDK                               | Deliberately, usually once a year                |
| Access policy, Telegram credentials, account data         | No — server-side                                 |
| Play App Signing certificate (`ANDROID_PLAY_CERT_SHA256`) | No — update the variable and redeploy Pages      |
| Version name and version code                             | Every build; the workflow renders them           |

The web app changes often; the native shell changes rarely. That is why the generated Android project is not committed:
the workflow renders it from `android/twa-manifest.template.json` on each run, so it stays aligned with the pinned
Bubblewrap version without a large, stale tree in the repository.

## One-time setup

### 1. Choose the identity

Pick these once; the first two are effectively permanent:

- **Origin** — the production custom domain, for example `https://tg.example.com`. It must be the Access-gated host, not
  the `*.pages.dev` preview host, and it must serve the site at `/`.
- **Package id** — your own reverse-DNS id, for example `com.example.telegramweb`. Do not reuse the upstream
  `com.rexezuge.telegramwebclient`; that is the canonical deployment's id.
- **App name / launcher name** — the name in Android settings and the label under the icon. Keep the launcher name short
  (12 characters or fewer).

### 2. Generate a keystore

Generate it yourself, outside the repository, and keep it out of Git. The same key signs every update to this app. The
`.gitignore` names the common keystore extensions (including the `.b64` form) as a backstop, not as permission to keep a
private key in the checkout.

```bash
keytool -genkeypair -v \
  -keystore release.jks \
  -storetype PKCS12 \
  -alias telegram \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Your Name, OU=Telegram Web, O=Your Org, L=City, ST=State, C=US"
```

`keytool` prompts for the store and key passwords. PKCS12 normally uses the same password for both. Back the file up;
losing it means you cannot update the installed app unless Play App Signing can reset your upload key.

Base64-encode it for the secret, again outside the repository:

```bash
base64 -w0 release.jks > release.jks.b64
```

On macOS, `base64 -i release.jks -o release.jks.b64` works too; line breaks in the secret are harmless. Read the public
SHA-256 fingerprint:

```bash
keytool -list -v -keystore release.jks -alias telegram \
  | sed -n 's/^[[:space:]]*SHA256: //p'
```

The value is a colon-separated, uppercase SHA-256 fingerprint. It is public configuration, not a secret.

### 3. Set the deployment's variables and secrets

Set these in the fork that deploys the site (Settings → Secrets and variables → Actions). They are per deployment.

| Kind     | Name                                         | Value                                                       |
| -------- | -------------------------------------------- | ----------------------------------------------------------- |
| Variable | `ANDROID_PWA_ORIGIN`                         | `https://tg.example.com` (no path or port; trailing `/` ok) |
| Variable | `ANDROID_PACKAGE_ID`                         | `com.example.telegramweb`                                   |
| Variable | `ANDROID_CERT_SHA256`                        | The keystore's SHA-256 fingerprint                          |
| Variable | `ANDROID_PLAY_CERT_SHA256`                   | Optional Play App Signing certificate fingerprint           |
| Variable | `ANDROID_APP_NAME` / `ANDROID_LAUNCHER_NAME` | Optional; default to `Telegram Web Client` / `Telegram Web` |
| Secret   | `ANDROID_KEYSTORE_BASE64`                    | The base64 of `release.jks`                                 |
| Secret   | `ANDROID_KEYSTORE_PASSWORD`                  | The store password                                          |
| Secret   | `ANDROID_KEY_ALIAS`                          | `telegram`                                                  |
| Secret   | `ANDROID_KEY_PASSWORD`                       | The key password                                            |

The two certificate variables are public. The keystore and its passwords are secrets; never commit them, share them, or
reuse another deployment's key.

`ANDROID_PACKAGE_ID` and `ANDROID_CERT_SHA256` also drive the **Pages** build: the Vite plugin writes
`/.well-known/assetlinks.json` from them. A deployment without an Android app leaves all of these unset, and the Pages
build emits no assetlinks file.

### 4. Deploy Pages before building Android

The TWA validates against the live origin and downloads its manifest and icons from it. Deploy the Pages project after
setting the variables, then verify the generated file:

```bash
curl -fsS https://tg.example.com/.well-known/assetlinks.json
```

It must return `200` directly (no redirect) with an `android_app` statement for your package id and the keystore's
fingerprint. The Access application must remain path-scoped to `/user*`: `/.well-known/assetlinks.json` is public, and
gating it would make the TWA verification fail.

If the file is missing, the Pages deployment predates the variables; push to `main` (or rerun the Pages deployment) and
check again.

### 5. Run the build

**Actions → Android Build → Run workflow.** The stable configuration comes from the variables above. The two optional
inputs are:

- `version_name` — defaults to the latest tag (with a leading `v` removed), or `0.0.0-dev.<run>` when the repository has
  no tags.
- `version_code` — defaults to the workflow run number.

The workflow:

1. validates the configuration and the live origin, manifest, icons and assetlinks, including rejecting certificate
   fingerprints the deployment no longer configures;
2. renders `android/build/twa-manifest.json` from `android/twa-manifest.template.json`;
3. runs Bubblewrap `update` and `build` with the pinned `1.27.0` release;
4. verifies both signatures against the keystore fingerprint;
5. uploads `app-release-signed.apk`, `app-release-bundle.aab` and `SHA256SUMS`.

Download the artifacts from the run and keep them somewhere durable; workflow artifacts expire. Verify the download:

```bash
sha256sum -c SHA256SUMS
```

### 6. Install and verify

```bash
adb install -r app-release-signed.apk
```

Open the app. The first paint is the deployment's own splash; after that, Chrome opens the site **without an address
bar** if the assetlinks check passed. Sign in through Cloudflare Access; the Access login opens in a Custom Tab and
returns to the app. Then check the chat list, a thread, an image, a video and the live updates socket.

If the URL bar is visible, see the troubleshooting section below.

## Versioning

Android's `versionCode` must increase for every update, and Google Play refuses an upload whose code is not higher than
the last one. The default is `github.run_number`, which increases for every run of this workflow and works for forks that
have no release tags. A workflow **re-run** keeps the same run number, so when re-uploading to Play set `version_code`
explicitly to a higher value.

`versionName` is the user-facing string. It does not have to be numeric, but the workflow accepts only letters, digits,
`.`, `_`, `+` and `-`, starting with a letter or digit. Keep it aligned with the web release for support.

The first build of a new package id has no previous code to beat; the default run number is fine, but pass
`version_code=1` if you prefer to start low. Play remembers the highest code ever uploaded.

## Google Play

- Upload the **AAB**, not the APK. The APK is for sideloading and device testing.
- Play App Signing re-signs the bundle with Google's app signing key. After enrolment, copy the **App signing key
  certificate** SHA-256 from Play Console → Test and release → Setup → App signing into `ANDROID_PLAY_CERT_SHA256` and
  redeploy Pages. The assetlinks file then lists both your upload key and Google's signing key, so installs from Play and
  sideloaded builds both verify.
- Access is a login wall. Google's reviewers need a way through it; provide test credentials or an Access policy that
  admits the reviewer, or the review may be rejected for requiring an inaccessible login.
- Use your own app name and iconography. Do not imply that the app is an official Telegram product.
- Play raises the required target SDK over time. Bubblewrap `1.27.0` targets SDK 36; when Play's requirement moves,
  bump Bubblewrap deliberately, rebuild and re-verify. The workflow also installs the build-tools release Bubblewrap
  pins (`36.1.0`); a Bubblewrap bump moves that pin and the workflow's install list together.
- Notification delegation is disabled (`enableNotifications: false`). The web app does not use web push; if that changes,
  enabling delegation also changes the native manifest and requires a rebuild.

## Troubleshooting

**The URL bar is visible.** The assetlinks check failed. Confirm the URL returns `200` with no redirect, names the exact
package id, and contains the exact keystore fingerprint. Re-deploy Pages after changing `ANDROID_PACKAGE_ID` or
`ANDROID_CERT_SHA256`. Chrome caches verification; uninstall/reinstall the app or clear Chrome's data for the origin
before retrying.

**The preflight says the live assetlinks do not name the package.** The Pages deployment has not run with the current
variables. Set them, deploy Pages, and rerun the Android build.

**The preflight says a fingerprint is missing.** For `ANDROID_CERT_SHA256`, the variable and the keystore secret
disagree; read the fingerprint from the keystore again, update the variable, redeploy Pages, and rerun. For
`ANDROID_PLAY_CERT_SHA256`, the Pages deployment predates the variable or was built with a different value; update it and
redeploy Pages.

**The preflight says the assetlinks name unexpected fingerprints.** The live file still trusts a key this deployment no
longer configures, often a rotated upload key or an old Play certificate. Redeploy Pages with the current variables so the
file is regenerated; if a variable still names the old key, update it first. Do not leave a stale key in place: it can
still sign an update that Chrome treats as this app.

**`INSTALL_FAILED_UPDATE_INCOMPATIBLE`.** The same package id is installed but signed with a different key. Uninstall the
old app first, or choose a new package id (which makes it a new app).

**`INSTALL_FAILED_VERSION_DOWNGRADE`.** The new APK's version code is lower than the installed one. Raise `version_code`.

**The build fails fetching an icon or the manifest.** The origin is not live, the icon is not a 512×512 PNG, or Access is
gating the asset. The workflow's preflight names the URL and status.

**Bubblewrap prompts for paths or passwords.** In CI the workflow writes `~/.bubblewrap/config.json` and sets
`BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD`. Locally, run `bubblewrap doctor` and `bubblewrap updateConfig`
once.

**`doctor` says the `androidSdkPath` is not correct.** Bubblewrap `1.27.0` still validates the pre-`cmdline-tools` SDK
layout and requires `<sdk>/tools` or `<sdk>/bin` to exist, even though modern SDKs ship neither. The workflow exposes
`cmdline-tools/latest/bin` as `<sdk>/bin` before writing the config, which also gives Bubblewrap the `sdkmanager` fallback
it expects. Do the same locally, or point it at an SDK root that already has one of those folders.

**The AAB will not install with `adb install`.** That is expected; AABs are for Play. Use the APK for device testing, or
`bundletool` to generate APKs from the bundle.

**The signing key is lost.** You cannot update the installed app with a new key. Play App Signing may allow an upload-key
reset; otherwise you need a new package id and a fresh install.

## Trust model

- Build your own app and sign it with your own key. Do not install an APK built and signed by another deployment.
- Never share the keystore or its passwords. The signing key is the app's update authority.
- The workflow's artifacts are for the deployment that ran it. There is deliberately no upstream release asset to
  mistake for a generic app.
- Inspect the workflow and the template before trusting them; both are small and reviewed in the repository.
