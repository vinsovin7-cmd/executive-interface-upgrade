# Android APK export

This project is a Next.js app with server routes, so the APK is a small native Android WebView shell that opens a deployed HTTPS version of CyberNode. The app UI and server-backed features continue to run on that deployment; this is not an offline/static export.

## Build with GitHub Actions

1. Push this branch to GitHub and merge the workflow to the repository's default branch; GitHub exposes manual workflows from the default branch.
2. Open **Actions → Build Android APK → Run workflow**.
3. The input defaults to `https://executive-interface-upgrade.vercel.app`; confirm it points to the deployed CyberNode app. The build rejects non-HTTPS URLs, credentials, query strings, and fragments.
4. When the workflow completes, download the `cybernode-debug-apk` artifact and extract `app-debug.apk`.
5. Transfer the APK to an Android device and install it. Android may ask you to allow installs from the app used to open the APK.

The artifact is a debug-signed test build, not a Play Store release. Each GitHub-hosted build uses a temporary debug signing key, so uninstall the previous test build before installing a later artifact. Do not use this APK for production distribution.

The Android WebView shell accepts HTTPS links for the configured app host and opens their path inside the app. These are unverified Android App Links; verified automatic domain association requires a stable signing certificate and a matching `/.well-known/assetlinks.json` on the deployed domain. The shell is a native Android WebView project, not a Capacitor project.

## Build locally

Install JDK 17, Gradle 8.10.2, and Android SDK platform 35/build-tools 35.0.0, then run the build script (defaults to the production URL; an alternate HTTPS URL can still be passed):

```bash
bash android/build-apk.sh
```

The resulting APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.
