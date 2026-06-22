# Antigravity Handoff

Workspace: `C:\Users\46743\OneDrive - Monarch\Documents\google ai studio apps\ai-studio-source-raw`

The app is set up as a standalone Sentinel LifeOps project:

- `npm run dev` starts the local Node/Vite server on `http://localhost:3000`.
- `npm run lint` runs TypeScript checks.
- `npm run build` creates the static production bundle.
- `npm run android:sync-assets` copies the built cockpit into the Android APK assets.
- `npm run android:build-debug` builds the separate `com.jackson.sentinellifeops` APK.
- `npm run android:install-debug` sideloads and launches that APK on the connected phone.

Model behavior:

- `server.ts` prefers the local Claude Code CLI when `CLAUDE_CODE_CLI_PATH` is configured.
- `server.ts` falls back to `@anthropic-ai/sdk` when `ANTHROPIC_API_KEY` has API credits available.
- If the API billing bucket is unavailable, the app falls back to deterministic local parsers and stays functional.
- Managed Antigravity or Claude Code credits are useful for local development work in this workspace.
- This workspace is intentionally local/Antigravity oriented.
- The Android bridge is independent of the existing Project Sentinel Android app and does not reuse its package.
