# The Android app

The SPA can also be shipped as a **native WebView shell**: a thin Android activity that renders the deployed origin
inside the app. There is no bundled web code and no browser hand-off — the PWA, its service worker and its updates socket
all run in the app's own WebView, whatever the reader's default browser is. This is the runbook for building one **per
deployment**.

## Why every deployment builds its own

The APK bakes in the host, the Android package id and the signing key. Those values belong to one deployment:

- A package id is unique on a device. Two deployments that reuse one collide at install time.
- A signing key is the update authority. An APK signed by somebody else cannot be trusted with your Telegram session.
- The origin receives the Access login and the account traffic. An upstream-signed APK points at the upstream origin.

So this repository does **not** publish a signed APK for everyone. Each deployment forks the repository, sets its own
variables and secrets, and runs **Actions → Android Build → Run workflow**. The workflow uploads the APK, the AAB and
`SHA256SUMS` as run artifacts; it does not attach them to a release and does not need `contents: write`.

## What requires a rebuild

| Change                                                | Rebuild the Android app?                       |
| ----------------------------------------------------- | ---------------------------------------------- |
| Web UI, API, service worker, chats, calls, uploads    | No — the shell loads the live origin           |
| App name, launcher name, launcher icon, theme colours | Yes — baked into the APK                       |
| Deployment origin or host                             | Yes — the origin is compiled into the WebView  |
| Package id                                            | Yes — and it is effectively a new app          |
| Signing key                                           | Yes — an update must be signed by the same key |
| Android Gradle plugin, Gradle, target SDK             | Deliberately, usually once a year              |
| Access policy, Telegram credentials, account data     | No — server-side                               |
| Version name and version code                         | Every build; the workflow renders them         |

The web app changes often; the native shell changes rarely. That is why the generated Gradle project is not committed:
the workflow renders it from `android/template/` on each run, so it stays aligned with the pinned toolchain without a
large, stale tree in the repository.

## One-time setup

### 1. Choose the identity

Pick these once; the first two are effectively permanent:

- **Origin** — the production custom domain, for example `https://tg.example.com`. It must be the Access-gated host, not
  the `*.pages.dev` preview host, and it must serve the site at `/`.
- **Package id** — your own reverse-DNS id, for example `com.example.pigeongram`. Do not reuse the upstream
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
  -dname "CN=Your Name, OU=Pigeongram, O=Your Org, L=City, ST=State, C=US"
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

The value is a colon-separated, uppercase SHA-256 fingerprint. It is public configuration, not a secret. The workflow
compares it with the keystore before building and with both signed artifacts afterwards.

### 3. Set the deployment's variables and secrets

Set these in the fork that deploys the site (Settings → Secrets and variables → Actions). They are per deployment.

| Kind     | Name                                         | Value                                                                             |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| Variable | `ANDROID_PWA_ORIGIN`                         | `https://tg.example.com` (no path or port; trailing `/` ok)                       |
| Variable | `ANDROID_PACKAGE_ID`                         | `com.example.pigeongram`                                                          |
| Variable | `ANDROID_CERT_SHA256`                        | The keystore's SHA-256 fingerprint                                                |
| Variable | `ANDROID_APP_NAME` / `ANDROID_LAUNCHER_NAME` | Optional; fall back to `VITE_APP_NAME` / `VITE_APP_SHORT_NAME`, then `Pigeongram` |
| Secret   | `ANDROID_KEYSTORE_BASE64`                    | The base64 of `release.jks`                                                       |
| Secret   | `ANDROID_KEYSTORE_PASSWORD`                  | The store password                                                                |
| Secret   | `ANDROID_KEY_ALIAS`                          | `telegram`                                                                        |
| Secret   | `ANDROID_KEY_PASSWORD`                       | The key password                                                                  |

`ANDROID_CERT_SHA256` is public: it is checked against the keystore and the built artifacts. The keystore and its
passwords are secrets; never commit them, share them, or reuse another deployment's key. There is no Digital Asset Links
variable — the shell does not use browser verification.

### 4. Deploy Pages before building Android

The app loads the live origin, so the site has to be up when the build's preflight runs. Deploy the Pages project first,
then confirm it serves the SPA and its manifest:

```bash
curl -fsS https://tg.example.com/
curl -fsS https://tg.example.com/manifest.webmanifest
```

Both must return `200` directly. The Access application must stay path-scoped to `/user*`: the document, the manifest,
the icons and the service worker stay public, while the account API and `/user/login` are gated.

### 5. Run the build

**Actions → Android Build → Run workflow.** The stable configuration comes from the variables above. The two optional
inputs are:

- `version_name` — defaults to the latest tag (with a leading `v` removed), or `0.0.0-dev.<run>` when the repository has
  no tags.
- `version_code` — defaults to the workflow run number.

The workflow:

1. validates the configuration and the live origin, manifest and certificate fingerprint;
2. decodes the keystore into `$RUNNER_TEMP` with mode `0600`;
3. renders `android/build/` from `android/template/`, including the launcher icons drawn from the same paper-plane mark
   the SPA uses;
4. builds the APK and AAB with the pinned Gradle `8.14.3` and Android Gradle plugin `8.13.0`;
5. verifies both signatures against the keystore fingerprint and that the APK declares the WebView launcher activity;
6. uploads `app-release-signed.apk`, `app-release-bundle.aab` and `SHA256SUMS`.

The step logic lives in `scripts/android/`, one script per step (`setup-sdk.ts`, `validate-config.ts`,
`decode-keystore.ts`, `verify-deployment.ts`, `render-android-project.ts`, `build-app.ts`, `verify-signatures.ts`,
`write-summary.ts`), so the workflow itself is only the sequence of commands. The rules the scripts enforce are covered
by `test/android/`.

Download the artifacts from the run and keep them somewhere durable; workflow artifacts expire. Verify the download:

```bash
sha256sum -c SHA256SUMS
```

### 6. Install and verify

```bash
adb install -r app-release-signed.apk
```

Open the app. The first paint is the deployment's splash, then the chat list or the intro — all inside the app, with no
address bar and no browser switch. Sign in through Cloudflare Access; the login completes in the WebView. Then check a
thread, an image, a video, the live updates socket, an attachment upload and a voice note.

Nothing about the app depends on the default browser: set it to any browser you like and the app still renders the PWA
itself.

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
- Play App Signing re-signs the bundle with Google's app signing key. The workflow verifies the upload-key certificate;
  a Play-signed install is no longer byte-identical to the artifact, which is expected.
- Access is a login wall. Google's reviewers need a way through it; provide test credentials or an Access policy that
  admits the reviewer, or the review may be rejected for requiring an inaccessible login.
- Use your own app name and iconography. Do not imply that the app is an official Telegram product, and do not use
  “Telegram” in the product or launcher name: Telegram's Terms of Service forbid it. The defaults use `Pigeongram`.
- The shell supports Android 7.0 (API 24) and newer, targets SDK 36, and compiles with Java 17. When Play raises its
  target requirement, bump the plugin/Gradle pins in `android/template/build.gradle` and the workflow together and
  rebuild deliberately.
- The web app does not use web push. Nothing needs notification delegation in the native shell.

## Troubleshooting

**The app opens the browser instead of the PWA.** That is the old Trusted Web Activity fallback (or an APK from another
deployment). This shell has no browser hand-off for `http(s)` navigation; install the current run's APK and confirm the
package id with `adb shell dumpsys package <package-id> | grep versionCode`.

**The app shows a blank page.** The preflight only proves the origin was up at build time. Check the current deployment
and the Access path scope; the WebView loads the live origin on every launch and has no cached shell of its own beyond
the service worker.

**Voice notes do not record.** The SPA needs microphone access that a browser normally asks for. The shell requests
`RECORD_AUDIO` on the first recording; grant it in Android's permission dialog. If it was denied permanently, enable it
in Android Settings → Apps → Pigeongram → Permissions.

**Attachments do not open the file picker.** The shell uses the system document picker with multiple selection enabled.
A device with no file manager cannot show one; install one and retry.

**Back leaves the app instead of closing the thread.** Back walks the WebView's own history first, so an in-app link goes
back one page before it can exit. The SPA's viewer and popup layers are same-URL history layers, so they close at the
right step.

**`INSTALL_FAILED_UPDATE_INCOMPATIBLE`.** The same package id is installed but signed with a different key. Uninstall the
old app first, or choose a new package id (which makes it a new app).

**`INSTALL_FAILED_VERSION_DOWNGRADE`.** The new APK's version code is lower than the installed one. Raise `version_code`.

**The build fails fetching the origin or the manifest.** The deployment is not live, or Access is gating a public asset.
The preflight names the URL and status.

**Gradle cannot find the SDK or the keystore.** The render step writes `local.properties` and `keystore.properties` from
the workflow's environment. Confirm `ANDROID_SDK_ROOT` and the decoded keystore path exist; locally, run the steps in
`scripts/android/` in the same order as the workflow.

**The AAB will not install with `adb install`.** That is expected; AABs are for Play. Use the APK for device testing, or
`bundletool` to generate APKs from the bundle.

**The signing key is lost.** You cannot update the installed app with a new key. Play App Signing may allow an upload-key
reset; otherwise you need a new package id and a fresh install.

## Trust model

- Build your own app and sign it with your own key. Do not install an APK built and signed by another deployment.
- Never share the keystore or its passwords. The signing key is the app's update authority.
- The workflow's artifacts are for the deployment that ran it. There is deliberately no upstream release asset to
  mistake for a generic app.
- Inspect the workflow and the template before trusting them; both are small and reviewed in the repository. The WebView
  renders the live origin over HTTPS and the worker is the only API surface, so the app has no privileged local bridge.
