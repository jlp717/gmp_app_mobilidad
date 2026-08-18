---
name: cicd-pipeline
description: CI/CD with GitHub Actions — pipeline stages, caching, secrets, deployment strategies, Node.js and Flutter workflows.
---

# CI/CD Pipeline — GitHub Actions Professional Guide

## Overview

A robust CI/CD pipeline is the safety net that makes fast, confident delivery possible. This guide covers workflow structure, multi-stage pipelines (lint → test → build → security → deploy), intelligent caching, secrets management, and deployment strategies for both Node.js and Flutter projects.

## When to Use

- Setting up a new repository's CI/CD from scratch
- Adding test coverage gates or security scanning to an existing pipeline
- Configuring environment-specific deployments with protection rules
- Optimizing slow pipelines with caching and matrix strategies

## When NOT to Use

- Monorepos with highly complex dependency graphs — consider Nx or Turborepo's own CI integration
- On-premises infrastructure without GitHub Actions runners — use GitLab CI or Jenkins instead

---

## Step-by-Step Process

### 1. Workflow Structure Fundamentals

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 3 * * 1'  # Weekly security scan on Monday 3am UTC

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # Cancel stale PR runs
```

### 2. Complete Node.js Pipeline

```yaml
jobs:
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check

  test:
    name: Unit & Integration Tests
    needs: lint
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run db:migrate:test
        env:
          DATABASE_URL: postgresql://postgres:testpassword@localhost:5432/testdb
      - run: npm test -- --coverage --ci
        env:
          DATABASE_URL: postgresql://postgres:testpassword@localhost:5432/testdb
          JWT_SECRET: test-secret-not-real
      - uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true

  security:
    name: Security Scan
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          severity: 'HIGH,CRITICAL'
          exit-code: '1'

  build:
    name: Build & Push Docker Image
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }},ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy-staging:
    name: Deploy to Staging
    needs: build
    runs-on: ubuntu-latest
    environment: staging          # Requires approval if configured
    steps:
      - uses: actions/checkout@v4
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.STAGING_HOST }}
          username: deploy
          key: ${{ secrets.STAGING_SSH_KEY }}
          script: |
            docker pull ghcr.io/${{ github.repository }}:${{ github.sha }}
            docker service update --image ghcr.io/${{ github.repository }}:${{ github.sha }} app_web

  deploy-production:
    name: Deploy to Production
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production       # Requires manual approval in GitHub UI
    steps:
      - name: Blue/Green Deploy
        run: |
          # Switch load balancer to green environment
          echo "Deploying ${{ github.sha }} to production"
```

### 3. Flutter CI Pipeline

```yaml
# .github/workflows/flutter.yml
name: Flutter CI

on:
  pull_request:
    branches: [main]

jobs:
  test:
    name: Flutter Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'
          cache: true                  # Caches Flutter SDK
      - name: Cache pub dependencies
        uses: actions/cache@v4
        with:
          path: ~/.pub-cache
          key: ${{ runner.os }}-pub-${{ hashFiles('**/pubspec.lock') }}
          restore-keys: ${{ runner.os }}-pub-
      - run: flutter pub get
      - run: flutter analyze --fatal-infos
      - run: flutter test --coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage/lcov.info
          token: ${{ secrets.CODECOV_TOKEN }}

  golden-tests:
    name: Golden Tests
    runs-on: ubuntu-latest            # Must match local OS for pixel-perfect goldens
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'
          cache: true
      - run: flutter pub get
      - run: flutter test --tags golden

  build-android:
    name: Build Android APK
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          cache: true
      - run: flutter pub get
      - run: flutter build apk --release
        env:
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
          ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: android-release
          path: build/app/outputs/flutter-apk/app-release.apk
```

### 4. Caching Strategy Summary

| Cache target | Key pattern |
|---|---|
| `node_modules` | `${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}` |
| Flutter SDK | Built into `subosito/flutter-action` with `cache: true` |
| Pub cache | `${{ runner.os }}-pub-${{ hashFiles('**/pubspec.lock') }}` |
| Docker layers | `type=gha` with `docker/build-push-action` |
| Gradle | `~/.gradle/caches` keyed on `build.gradle` hash |

### 5. Secrets Management Rules

- Store secrets in **GitHub → Settings → Secrets and Variables → Actions**
- Use **Environment secrets** for prod-only values; require approval on the `production` environment
- Never `echo` secrets; GitHub will redact them but it's still bad practice
- Rotate secrets immediately after a leak; use `gh secret set` for automation
- Use OIDC (`permissions: id-token: write`) instead of long-lived cloud credentials when deploying to AWS/GCP/Azure

### 6. Deployment Strategies

| Strategy | When to use |
|---|---|
| **Rolling** | Zero-downtime; swap instances one at a time (default for most apps) |
| **Blue/Green** | Instant rollback; double resource cost during deploy |
| **Canary** | Gradual traffic shift (5% → 25% → 100%); requires traffic splitting at load balancer |

---

## Verification Checklist

- [ ] `concurrency` group configured to cancel stale PR runs
- [ ] `npm ci` used instead of `npm install` (reproducible installs)
- [ ] Test step has `--ci` flag (no interactive prompts, fail on missing snapshots)
- [ ] Coverage uploaded to Codecov/Coveralls with failure on error
- [ ] `npm audit --audit-level=high` blocks the pipeline on high/critical CVEs
- [ ] Docker builds use `cache-from/cache-to: type=gha` for layer caching
- [ ] Production deploy job requires manual approval via GitHub Environments
- [ ] All secrets accessed via `${{ secrets.NAME }}` — no hardcoded values
- [ ] Flutter goldens run on `ubuntu-latest` consistently across team and CI
- [ ] `flutter analyze --fatal-infos` fails on any analyzer warning
- [ ] Deployment uses immutable image tags (`github.sha`), not `latest`
