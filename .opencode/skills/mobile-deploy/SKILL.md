---
name: mobile-deploy
description: Flutter mobile deployment — build APK/AAB/IPA, Fastlane CI/CD, Play Store & TestFlight, signing, Firebase App Distribution, Codemagic/Bitrise, Crashlytics, store listing checklists.
---

# Mobile Deployment — Flutter Production Guide

## Overview

Shipping a Flutter app to production involves build configuration, code signing, store metadata, and CI/CD automation. This guide covers the complete path from `flutter build` to Google Play and App Store Connect, including Fastlane automation, version management, signing security, and deployment checklists.

## When to Use

- Preparing a release build for Google Play or App Store
- Setting up CI/CD for automated builds and distribution
- Managing signing keys, keystores, and provisioning profiles
- Distributing beta builds via TestFlight or Firebase App Distribution
- Configuring Fastlane for automated store uploads
- Setting up Crashlytics for production crash monitoring

## When NOT to Use

- Internal testing without store requirements — use `flutter build apk --debug` and sideload
- Enterprise distribution (MDM) — use Apple Enterprise Program or Android Enterprise instead
- Web or desktop builds — this guide is mobile-specific (iOS/Android)

---

## Step-by-Step Process

### 1. Version Code & Build Number Management

Every release needs two version identifiers:

| Identifier | Android | iOS | Purpose |
|---|---|---|---|
| **Version name** | `versionName` in `build.gradle` | `CFBundleShortVersionString` | User-facing (e.g. `1.4.2`) |
| **Version code** | `versionCode` in `build.gradle` | `CFBundleVersion` | Monotonic integer for store |

```yaml
# pubspec.yaml — single source of truth
name: gmp_app_mobilidad
version: 1.4.2+15  # <semver>+<build_number>
```

```groovy
// android/app/build.gradle — derive from pubspec
def flutterVersionCode = flutterVersionCode ?: '1'
def flutterVersionName = flutterVersionName ?: '1.0.0'

android {
    defaultConfig {
        versionCode flutterVersionCode.toInteger()
        versionName flutterVersionName
    }
}
```

```xml
<!-- ios/Runner/Info.plist — auto-synced by Flutter tooling -->
<key>CFBundleShortVersionString</key>
<string>$(FLUTTER_BUILD_NAME)</string>
<key>CFBundleVersion</key>
<string>$(FLUTTER_BUILD_NUMBER)</string>
```

**Rules:**
- `versionCode` / `CFBundleVersion` MUST increment on every upload — stores reject duplicates
- `versionName` / `CFBundleShortVersionString` follows semver — user-visible
- Never reset version code — it's a lifetime monotonic counter

### 2. Android Signing — Keystore Configuration

```bash
# Generate a production keystore (do this ONCE, back it up securely)
keytool -genkey -v \
  -keystore ~/upload-keystore.jks \
  -storetype JKS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias upload
```

```properties
# android/key.properties — NEVER commit this file
storePassword=<keystore_password>
keyPassword=<key_password>
keyAlias=upload
storeFile=../../upload-keystore.jks
```

```groovy
// android/app/build.gradle — signing config
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

**Security rules:**
- Keystore file goes in `.gitignore` — never commit
- Store passwords in CI secrets, not in `key.properties` for shared repos
- Use Google Play App Signing — upload key can be rotated; Google holds the app signing key
- Back up the keystore to a secure vault — losing it means you can never update the app

### 3. iOS Signing — Certificates & Provisioning Profiles

```bash
# Using Fastlane match (recommended — team-shared signing)
fastlane match appstore
fastlane match adhoc
fastlane match development
```

Match stores certificates and profiles in an encrypted Git repo. Team members run `fastlane match` to sync.

**Manual approach (if not using match):**
1. Apple Developer Portal → Certificates → Create Distribution certificate
2. App IDs → Register bundle identifier
3. Provisioning Profiles → Create App Store profile
4. Download `.p12` (cert) and `.mobileprovision` (profile)
5. Install locally: double-click both files

**Xcode project settings:**
- Signing & Capabilities → Team: select your team
- Signing Certificate: `Apple Distribution`
- Provisioning Profile: `match AppStore <bundle_id>`

### 4. Build Commands

```bash
# ── Android ──────────────────────────────────────────────

# APK (sideloading, Firebase App Distribution, direct download)
flutter build apk --release

# Split APKs by ABI (smaller downloads)
flutter build apk --release --split-per-abi
# Outputs: app-armeabi-v7a-release.apk, app-arm64-v8a-release.apk, app-x86_64-release.apk

# AAB (Android App Bundle — REQUIRED for Google Play)
flutter build appbundle --release
# Output: build/app/outputs/bundle/release/app-release.aab
```

```bash
# ── iOS ──────────────────────────────────────────────────

# IPA (requires macOS + Xcode)
flutter build ipa --release

# With export options (ad-hoc distribution)
flutter build ipa --release --export-method ad-hoc

# Output: build/ios/ipa/<app_name>.ipa
# Also generates: build/ios/archive/Runner.xcarchive
```

**AAB vs APK — when to use which:**

| Format | Use case | Size | Store required |
|---|---|---|---|
| **AAB** | Google Play upload | Smaller (Play generates optimized APKs per device) | Yes |
| **APK (universal)** | Firebase App Distribution, direct download | Largest (all ABIs bundled) | No |
| **APK (split)** | Manual sideload by ABI | Smallest per device | No |

**Always upload AAB to Google Play.** APK uploads are deprecated for new apps.

### 5. Fastlane — Automated CI/CD

```ruby
# fastlane/Fastfile
default_platform(:flutter)

platform :android do
  desc "Build and upload to Google Play internal testing"
  lane :beta do
    gradle(
      task: "bundle",
      build_type: "Release",
      project_dir: "android"
    )
    upload_to_play_store(
      track: "internal",
      aab: "build/app/outputs/bundle/release/app-release.aab",
      release_status: "draft",  # or "completed" for immediate rollout
      skip_upload_changelogs: false,
      skip_upload_images: false,
      skip_upload_screenshots: false,
    )
  end

  desc "Promote internal to production"
  lane :promote_to_production do
    upload_to_play_store(
      track: "production",
      track_promote_from: "internal",
      release_status: "completed",
    )
  end
end

platform :ios do
  desc "Build and upload to TestFlight"
  lane :beta do
    build_app(
      scheme: "Runner",
      export_method: "app-store",
      clean: true,
    )
    upload_to_testflight(
      skip_waiting_for_build_processing: false,
      distribute_external: true,  # notify external testers
      notify_external_testers: true,
    )
  end
end
```

```ruby
# fastlane/Pluginfile
gem 'fastlane-plugin-flutter_version'
gem 'fastlane-plugin-versioning'
```

**Fastlane setup:**
```bash
# Install Fastlane (requires Ruby 2.7+)
sudo gem install fastlane -NV

# Initialize in project root
cd your_flutter_project
fastlane init

# For Android: supply Google Play API JSON key
# For iOS: supply Apple ID or App Store Connect API key
```

**Google Play API key setup:**
1. Google Play Console → Settings → API access
2. Create service account → grant "Release Manager" role
3. Download JSON key → save as `fastlane/play_store_api_key.json`
4. Add to `.gitignore`

**App Store Connect API key setup:**
```bash
# Generate API key in App Store Connect → Users and Access → Keys
# Download .p8 file → save securely
export FASTLANE_KEY_ID="ABC123"
export FASTLANE_ISSUER_ID="your-issuer-id"
export FASTLANE_KEY_PATH="./fastlane/AuthKey_ABC123.p8"
```

### 6. Google Play Store Deployment Tracks

| Track | Audience | Review time | Use case |
|---|---|---|---|
| **internal** | Up to 100 testers | Minutes (often instant) | QA team, dogfooding |
| **closed** | Defined email lists / Google Groups | 1-3 days | Beta program, customer testing |
| **open** | Anyone who joins | 1-3 days | Public beta |
| **production** | All users | 1-7 days (first release longer) | Live release |

```ruby
# Fastlane — upload to specific track
lane :internal do
  upload_to_play_store(track: "internal")
end

lane :closed_beta do
  upload_to_play_store(
    track: "closed",
    track_promote_from: "internal",
    release_name: "v#{get_version_name()}",
  )
end

lane :production do
  upload_to_play_store(
    track: "production",
    track_promote_from: "closed",
    rollout: "0.1",  # staged rollout: 10% of users
  )
end
```

**Staged rollouts:** Start at 10%, monitor Crashlytics, then increase to 50% → 100%. If crash rate spikes, halt immediately.

### 7. Apple TestFlight Deployment

```ruby
# Fastlane — TestFlight upload
lane :testflight do
  increment_build_number(
    build_number: latest_testflight_build_number + 1
  )
  build_app(scheme: "Runner")
  upload_to_testflight(
    skip_waiting_for_build_processing: true,  # async processing
    notify_external_testers: true,
    groups: ["Beta Testers", "Internal QA"],
  )
end
```

**TestFlight workflow:**
1. Upload build → Apple processes (5-30 min)
2. Internal testers (up to 100 team members) → instant access
3. External testers (up to 10,000) → requires Beta App Review (first build only)
4. Build expires after 90 days — upload new builds regularly

**App Store Connect API vs Apple ID:**
- API key (`.p8`) → recommended for CI/CD, no 2FA prompts
- Apple ID → interactive, requires 2FA, not suitable for headless CI

### 8. Firebase App Distribution

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Add to Flutter project
flutter pub add firebase_app_distribution
```

```ruby
# fastlane/Fastlane — Firebase distribution
lane :firebase_android do
  gradle(task: "assemble", build_type: "Release", project_dir: "android")
  firebase_app_distribution(
    app: "1:123456789:android:abcdef",  # Firebase App ID
    apk: "build/app/outputs/flutter-apk/app-release.apk",
    groups: "qa-team, stakeholders",
    release_notes: "Build #{lane_context[SharedValues::FLUTTER_BUILD_NUMBER]}",
    testers: "tester@example.com",
  )
end

lane :firebase_ios do
  build_app(scheme: "Runner")
  firebase_app_distribution(
    app: "1:123456789:ios:abcdef",
    ipa: "build/ios/ipa/Runner.ipa",
    groups: "qa-team",
    release_notes: "Build #{lane_context[SharedValues::FLUTTER_BUILD_NUMBER]}",
  )
end
```

**Firebase App Distribution benefits:**
- No store review required — instant delivery
- Testers install Firebase App Distribution app, then your app
- Crash reports tied to specific builds
- Built-in tester management (groups, emails)

### 9. Codemagic CI/CD Integration

```yaml
# codemagic.yaml — placed at project root
definitions:
  environment:
    flutter: 3.24.0
    xcode: latest
    cocoapods: default
    groups:
      - google_play     # Contains service account JSON
      - app_store       # Contains API key, certs
      - firebase        # Contains firebase token

workflows:
  android-beta:
    name: Android Beta
    instance_type: linux_x2
    environment:
      flutter: 3.24.0
      groups:
        - google_play
        - firebase
    triggering:
      events:
        - push
      branch_patterns:
        - pattern: "main"
          include: true
    scripts:
      - name: Setup signing
        script: |
          echo $ANDROID_KEYSTORE | base64 --decode > android/app/keystore.jks
          echo "storeFile=keystore.jks" > android/key.properties
          echo "storePassword=$KEYSTORE_PASSWORD" >> android/key.properties
          echo "keyPassword=$KEY_PASSWORD" >> android/key.properties
          echo "keyAlias=$KEY_ALIAS" >> android/key.properties
      - name: Flutter build AAB
        script: |
          flutter pub get
          flutter build appbundle --release
      - name: Upload to Play Store
        script: |
          fastlane android beta
    artifacts:
      - build/app/outputs/bundle/release/app-release.aab
      - build/app/outputs/flutter-apk/app-release.apk

  ios-beta:
    name: iOS Beta
    instance_type: mac_mini_m1
    environment:
      flutter: 3.24.0
      groups:
        - app_store
        - firebase
      ios_signing:
        distribution_type: app_store
        bundle_identifier: com.example.gmp
    triggering:
      events:
        - push
      branch_patterns:
        - pattern: "main"
          include: true
    scripts:
      - name: Flutter build IPA
        script: |
          flutter pub get
          flutter build ipa --release --export-method app-store
      - name: Upload to TestFlight
        script: |
          fastlane ios beta
    artifacts:
      - build/ios/ipa/*.ipa
```

### 10. Bitrise CI/CD Integration

Bitrise uses a visual workflow editor. Key steps for Flutter:

1. **Activate SSH key** — for private pub repos
2. **Git Clone** — checkout code
3. **Flutter Installer** — set Flutter version
4. **Flutter Analyze** — `flutter analyze`
5. **Flutter Test** — `flutter test`
6. **Android Build** (for APK/AAB):
   - **Android Build** step → build type: `release`
   - **Google Play Deploy** step → upload AAB
7. **iOS Build** (for IPA):
   - **Certificate and profile installer** — install signing assets
   - **Flutter Build** → `flutter build ipa`
   - **Deploy to iTunes Connect** — upload to TestFlight

**bitrise.yml (exported config):**
```yaml
format_version: "13"
default_step_lib_source: https://github.com/bitrise-io/bitrise-steplib.git

workflows:
  flutter-android-release:
    steps:
      - activate-ssh-key@4: {}
      - git-clone@8: {}
      - flutter-installer@1:
          inputs:
            - version: "3.24.0"
      - script@1:
          title: Flutter analyze & test
          inputs:
            - content: |
                flutter pub get
                flutter analyze
                flutter test
      - android-build@1:
          inputs:
            - variant: release
            - module: app
            - build_type: aab
      - google-play-deploy@3:
          inputs:
            - app_path: "$BITRISE_AAB_PATH"
            - track: internal
            - service_account_json_key_path: "$BITRISEIO_SERVICE_ACCOUNT_JSON_KEY_URL"
```

### 11. Crashlytics / Firebase Crash Reporting

```bash
# Add Firebase to Flutter project
flutter pub add firebase_core firebase_crashlytics
flutterfire configure  # generates firebase_options.dart
```

```dart
// lib/main.dart — initialize Crashlytics
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Pass all uncaught errors to Crashlytics
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };

  // Optional: set user identifier for crash correlation
  // FirebaseCrashlytics.instance.setUserIdentifier('user_123');

  // Optional: set custom keys for debugging context
  // FirebaseCrashlytics.instance.setCustomKey('role', 'COMERCIAL');
  // FirebaseCrashlytics.instance.setCustomKey('app_version', '1.4.2');

  runApp(const MyApp());
}
```

**Crashlytics best practices:**
- Log breadcrumbs for key user actions: `FirebaseCrashlytics.instance.log('Navigated to rutero')`
- Set user ID after login to correlate crashes with specific accounts
- Use custom keys for role, vendor code, feature flags — helps triage
- Enable `firebase_crashlytics` in release builds only (debug builds use local error handler)
- Review Crashlytics dashboard before each release — fix top crashes first

### 12. CHANGELOG & Release Notes

```markdown
# CHANGELOG.md

## 1.4.2 (2026-05-11)

### Fixed
- Repartidor route detail showing stale albaranes after refresh
- Cobros summary not updating after payment confirmation

### Changed
- Improved loading skeleton animation on dashboard KPIs

### Added
- Share route button with PDF export in rutero detail

## 1.4.1 (2026-05-04)

### Fixed
- Vendor 'ALL' filter returning empty results for jefe_ventas role
```

**Fastlane — auto-generate release notes from CHANGELOG:**
```ruby
# fastlane/Fastfile
def get_release_notes
  changelog = File.read("../CHANGELOG.md")
  # Extract latest version section
  match = changelog.match(/## [\d.]+[^\n]*\n((?:.|\n)*?)(?=\n## |\z)/)
  match ? match[1].strip : "Bug fixes and improvements"
end

lane :beta do
  upload_to_play_store(
    track: "internal",
    release_status: "draft",
    what's_new: get_release_notes,
  )
end
```

**Google Play release notes limits:**
- "What's new" field: max 500 characters
- Full description: max 4000 characters
- Short description: max 80 characters

### 13. Store Listing Assets Checklist

**Google Play Store:**

| Asset | Specification | Required |
|---|---|---|
| App icon | 512x512 PNG, 32-bit, no alpha | Yes |
| Feature graphic | 1024x500 PNG/JPEG | Yes |
| Phone screenshots | Min 2, max 8; 16:9 or 9:16; PNG/JPEG | Yes |
| 7-inch tablet screenshots | 2 min; 1280x720 or 1920x1200 | If tablet support |
| 10-inch tablet screenshots | 2 min; 1920x1200 or 2560x1600 | If tablet support |
| Short description | Max 80 characters | Yes |
| Full description | Max 4000 characters | Yes |
| App category | Free / Paid + category | Yes |
| Contact email | For support | Yes |
| Privacy policy URL | HTTPS URL | Yes |

**Apple App Store:**

| Asset | Specification | Required |
|---|---|---|
| App icon | 1024x1024 PNG, no alpha, no transparency | Yes |
| iPhone screenshots (6.7") | 1290x2796 PNG/JPEG, min 1 | Yes |
| iPhone screenshots (6.5") | 1284x2778 PNG/JPEG | Recommended |
| iPad screenshots (12.9") | 2048x2732 PNG/JPEG | If iPad support |
| App preview video | 15-30s, 1080p-4K, no overlays | Optional |
| Description | Max 4000 characters | Yes |
| Keywords | Max 100 characters, comma-separated | Yes |
| Support URL | HTTPS URL | Yes |
| Marketing URL | Optional landing page | Optional |
| Privacy policy URL | HTTPS URL | Yes |

**Pre-submission checklist:**
- [ ] App icon renders correctly on all device sizes (no blurry edges)
- [ ] Screenshots show actual app UI — no placeholder/mock data
- [ ] All text in screenshots is localized for target markets
- [ ] `versionCode` / `CFBundleVersion` incremented from previous release
- [ ] CHANGELOG updated with user-facing changes
- [ ] Release notes written for store "What's new" field
- [ ] Privacy policy URL is accessible and up to date
- [ ] Crashlytics dashboard reviewed — no new crash clusters
- [ ] `flutter analyze` passes with zero warnings
- [ ] All tests pass (`flutter test`)
- [ ] Keystore / signing certificates are valid (not expired)
- [ ] ProGuard/R8 rules tested — no missing classes in release build
- [ ] App size is reasonable (AAB < 150MB without on-demand assets)
- [ ] Deep links / universal links tested on production URL scheme
- [ ] Firebase config (`firebase_options.dart`) includes production project

---

## Verification Checklist

- [ ] `pubspec.yaml` version follows `semver+build_number` format
- [ ] `versionCode` incremented — store will not accept duplicate
- [ ] Keystore file in `.gitignore` — never committed to repo
- [ ] Keystore backed up to secure vault (not just local machine)
- [ ] Google Play App Signing enabled — upload key is rotatable
- [ ] iOS provisioning profile not expired (check in Apple Developer Portal)
- [ ] Fastlane `Fastfile` tested locally before committing to CI
- [ ] Google Play API JSON key scoped to correct project and role
- [ ] App Store Connect API key has "App Manager" role (not just "Developer")
- [ ] AAB used for Google Play upload (not universal APK)
- [ ] `minifyEnabled` and `shrinkResources` enabled for release builds
- [ ] ProGuard rules tested — no `ClassNotFoundException` in release
- [ ] Crashlytics initialized in `main()` with error handlers wired
- [ ] Release notes under 500 characters for Play Store "What's new"
- [ ] Screenshots match current UI — no outdated branding or features
- [ ] Privacy policy URL returns 200 and covers data collection practices
- [ ] Firebase App Distribution group includes all intended testers
- [ ] CI pipeline fails on `flutter analyze` warnings or test failures
- [ ] Staged rollout configured for production releases (start at 10%)
