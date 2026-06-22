# Sentinel LifeOps

Standalone Antigravity-ready Sentinel LifeOps cockpit with a separate Android APK bridge for owner-approved phone telemetry.

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## AI Runtime

The local Node server can use an AI route in three ways:

- `CLAUDE_PROVIDER=managed-agent` with `CLAUDE_CODE_CLI_PATH`: preferred local path when you want managed Claude Code credits instead of Anthropic API billing.
- `ANTHROPIC_API_KEY`: SDK path if you intentionally want to use Anthropic API credits.
- `AI_PROVIDER=deepseek` or `CLAUDE_PROVIDER=deepseek` with `DEEPSEEK_API_KEY`: OpenAI-compatible DeepSeek route.

Without either, the app keeps working with deterministic local fallback parsers.

The Smart Inbox can also answer questions about loaded phone context through `POST /api/ask-lifeops`. The manual "Have AI check" button calls `POST /api/check-relevance` once on demand to suggest irrelevant items you may want to clear as not tasks. If no AI route is configured, the app falls back to local rules so Android can still answer basic priority, evidence, and cleanup questions.

Copy `.env.example` to `.env` and fill:

```env
ANTHROPIC_API_KEY=
CLAUDE_PROVIDER=managed-agent
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_CODE_CLI_PATH=
CLAUDE_CODE_MODEL=sonnet
AI_PROVIDER=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
SENTINEL_INGEST_TOKEN=
SENTINEL_ALLOWED_ORIGINS=
VITE_PUBLIC_INGEST_BASE_URL=
VITE_SENTINEL_INGEST_TOKEN=
```

## Package

```powershell
npm run lint
npm run build
```

## Android

The Android package is separate from the older Sentinel app:

- Package: `com.jackson.sentinellifeops`
- Project: `android-lifeops`
- Bridge: `window.SentinelAndroid`

Build and install:

```powershell
npm run build
npm run android:sync-assets
npm run android:build-debug
npm run android:install-debug
```

The APK reads phone telemetry through Android permissions and OS settings: SMS, call log, contacts, calendar, location, usage access, notification listener, and accessibility screen text. The installed WebView cockpit automatically uses the native bridge instead of the desktop Node API.

For local managed-Claude actions from the sideloaded APK, keep the LifeOps server running on the computer and forward the port while the phone is connected with ADB:

```powershell
adb reverse tcp:3000 tcp:3000
```

For CBT Sentinel integration, `app_usage` records include derived foreground-open metadata when Usage Access is available:

```json
{
  "source": "app_usage",
  "packageName": "com.google.android.gm",
  "metadata": {
    "windowMinutes": 1440,
    "foregroundCount": 12,
    "foregroundTimestamps": [1780239720000],
    "eventSource": "UsageStatsManager.queryEvents"
  }
}
```

Desktop exports are available through `GET /api/telemetry` with `X-Sentinel-Ingest-Token` when `SENTINEL_INGEST_TOKEN` is configured, or from loopback during local development. The same data is stored at `.sentinel-lifeops/telemetry.json` under the configured `SENTINEL_DATA_DIR`.

## Privacy / Local Storage

When you use the desktop Node server, `.sentinel-lifeops/telemetry.json` stores raw phone telemetry content in plaintext on disk. That is acceptable for personal local use, but keep the folder private, delete the file when you want to clear history, or set `SENTINEL_DATA_DIR` to move it somewhere else.

This project is local/Antigravity and Android-sideload oriented. It has no external hosting target configured.
