# Sentinel LifeOps — Improvement Proposal (July 2026)

Analysis-only review of `C:\Users\46743\sentinel-lifeops` covering UI/UX and functionality across the three sub-apps
(Express backend `server.ts`, React 19 web UI `src/LifeOpsApp.tsx`, Android WebView shell `android-lifeops`).

**Telemetry-safety ground rule applied throughout:** nothing below reduces or interferes with full telemetry capture
(SMS, notifications, calendar, location, app_usage, screen_text, user notes). Several proposals *increase* capture
fidelity. The frozen CBT contract — `GET /api/telemetry` returning `{logs:[...]}` with the 7-source enum and
`id/timestamp/source/title/content/capturedAtEpochMillis/packageName/metadata` — is untouched; anything additive is
explicitly marked shape-preserving.

**Known deferred security items (pending, not re-litigated here):** ingest-token rotation + git history purge,
bind-host flip to 127.0.0.1 (note: `server.ts:60` already *defaults* to 127.0.0.1; the pending item is the deployed
config), and cleartext → `network-security-config` on Android (`AndroidManifest.xml:22` still has
`android:usesCleartextTraffic="true"`).

---

## 1. Executive summary — top 5 highest-leverage improvements

1. **Export/pipeline health surface (functional, highest daily-driver value).** Today there is no way to see whether
   telemetry is actually reaching CBT Sentinel. The 30-min `TelemetryExportWorker` logs only to logcat; the bridge
   status JSON (`SentinelBridge.getBridgeStatusJson`, `SentinelBridge.java:88`) says nothing about the last export.
   Persist last-export time/status/count in SharedPreferences on every export (foreground *and* worker), add them to
   the status JSON, and render an "Export health" card on the Access screen. Small change, closes the biggest
   operational blind spot.

2. **Fix the suggestion-dismissal split brain (UX + lifecycle bug).** A suggestion card has two "Not a task" paths
   with different semantics: the situation-feedback button records a fingerprint suppression
   (`applySituationFeedback`, `LifeOpsApp.tsx:653`) while the card-level "Not a task" `ActionButton`
   (`LifeOpsApp.tsx:1211-1217`) only removes the item from `extractedTasks` — so the same suggestion resurfaces on the
   next auto-extract, and because `visibleSuggestionTasks` falls back to `smartTasksFromSituations` when
   `extractedTasks` empties (`LifeOpsApp.tsx:391-400`), dismissing the *last* card makes dismissed smart suggestions
   pop straight back. Whack-a-mole behavior that directly erodes trust in the Suggested tab.

3. **Decompose `LifeOpsApp.tsx` (~1,860 lines, 30+ `useState`) into screen components + a reducer.** The god
   component makes every one of the other fixes riskier. Extraction path and state plan in §2.7.

4. **Heuristic engine parity harness (TS ↔ Java).** `src/lifeopsRules.ts` and `SentinelBridge.java` deliberately
   mirror each other and have **already drifted** (concrete examples in §4.2 — e.g. Java's promo/noise word list
   includes `"weather"`/`"battery"` and uses space-padded `contains`, TS uses word-boundary regex without those
   words). Add a shared JSON fixture file both test suites consume so drift fails a test instead of silently
   re-ranking telemetry differently on phone vs desktop.

5. **Raise on-device retention caps for notifications/screen text (capture-fidelity win).**
   `SentinelNotificationListenerService.MAX_RECENT = 30` and `SentinelAccessibilityService.MAX_RECENT = 12` are
   in-memory ring buffers; a busy hour plus a 30-minute worker interval means real notifications age out of the buffer
   before they are ever exported, and a process death loses everything in RAM. Persisting these buffers (and raising
   caps) is a pure telemetry-fidelity improvement, fully aligned with the hard rule.

---

## 2. UI/UX findings — screen by screen

Screen inventory (bottom nav, `LifeOpsApp.tsx:1713-1719`): **Today** (`today`), **Inbox** (`signals`),
**Suggested** (`suggestions`), **Current** (`task`), **Access** (`access`), plus three modals (Add Task, Stuck,
Delay) and the global notice banner.

### 2.0 Cross-cutting

- **Naming inconsistency between code, nav, and headers.** Tab key `signals` is labeled "Inbox" in the nav but its
  header says "Phone Inbox / Raw phone material" (`LifeOpsApp.tsx:1433-1434`); key `task` is labeled "Current" but the
  header says "Current Task"; `suggestions` is "Suggested" in nav, "Suggested Tasks" in-page, and "Open suggested
  tasks" / "Open suggested" in cross-links. Pick one noun per screen ("Inbox", "Suggestions", "Current Task",
  "Access") and use it in nav, headers, and every cross-link. Quick win, big coherence gain.
- **One global `notice` banner carries every kind of message** — sync results, export failures, feedback
  confirmations, timeline alerts (`LifeOpsApp.tsx:353`, rendered at `1271-1284`). Messages overwrite each other (a
  "Leave time has passed" alert can be clobbered 30s later by a routine "Added 3 phone signals" sync message), never
  auto-dismiss, and some run to 3+ lines. Fixes: (a) auto-dismiss `info` severity after ~6s, keep `warning`/`error`
  sticky; (b) never let periodic-sync notices overwrite an unacknowledged `error`; (c) add `role="status"`/
  `aria-live="polite"` for the WebView's accessibility tree. Longer term, split "timeline alarms" out of the generic
  notice channel entirely (they deserve the drift-banner treatment, not a toast).
- **Mobile ergonomics of the fixed chrome.** The bottom nav is anchored at `bottom-12` (3rem above the viewport
  bottom, `LifeOpsApp.tsx:1711`) and the header hard-codes `pt-10` (`:1250`) — both look like hand-tuned offsets for
  the Android status/gesture bars. On devices with different insets this leaves a dead 3rem strip below the nav (tap
  target confusion) or clips under the status bar. Proper fix: `viewport-fit=cover` in `index.html:5` plus
  `padding-bottom: env(safe-area-inset-bottom)` / `padding-top: env(safe-area-inset-top)` on nav/header, then shrink
  `main`'s `pb-56` (`:1286`) — 14rem of scroll padding is compensating for the same guesswork.
- **Design-token adoption is half-finished.** `src/index.css` defines the calm semantic tokens and `components/ui.tsx`
  uses them, but `LifeOpsApp.tsx` still hand-rolls hundreds of `bg-slate-900 border-slate-800 text-slate-400`
  utilities (remapped by the legacy ramp, so it *looks* right but is unmaintainable) and duplicates card/pill/input
  styles inline everywhere (e.g. the same input class string appears 12+ times). Every extraction in §2.7 should land
  on `Panel`/`Pill`/`StatTile`/`SectionIntro` + tokens; also promote a shared `TextInput`/`TextArea`/`Select` and a
  `Modal` primitive into `components/ui.tsx` (three modals re-implement the same overlay shell at `:1738`, `:1772`,
  `:1814`).
- **No sync-in-progress affordance.** `syncTelemetryLogs` (`:477`) has no `isSyncing` state — tapping "Refresh phone
  data" gives zero feedback until the notice appears (or silently never, when not forced). Add a spinner/disabled
  state to every Refresh button; there are five of them (see redundancy below).

### 2.1 Today

- **Good bones:** the "What should I do now?" panel with contextual actions (`:1289-1328`) is the right idea — one
  question, one answer.
- **Redundant chrome:** "Refresh phone data", "Create suggestions", "Add task manually" appear here *and* on
  Suggestions *and* on Inbox (six Refresh/Build buttons across three screens). Keep the full action row on Today only;
  on Inbox/Suggestions reduce to a single small refresh icon in the section header. Fewer identical buttons = clearer
  affordance hierarchy.
- **Information hierarchy:** the three-card summary grid (`Phone data` / `Suggestions` / `Phone access`,
  `:1343-1362`) buries the single number that matters (suggestions waiting) below the fold on a phone. Reorder:
  suggestion count + top suggested task title first (with a one-tap "Start" affordance inline), telemetry counts
  second, access third. The `Phone data` card also shows only 4 of 7 sources (no calls/app_usage/location) — either
  show all seven or label it "capture last 24h" with a link to Inbox.
- **Dead-end:** when `visibleSuggestionTasks.length > 0` the panel says "Pick one suggested task" but offers no
  inline pick — the user must find the Suggestions tab themselves. Render the top 1-2 suggestion titles as tappable
  rows right there.

### 2.2 Suggestions ("Suggested")

- **The split-brain dismissal (top-5 item #2).** Concretely: `renderTaskCard`'s "Not a task" button (`:1211-1217`)
  must call the same fingerprint-suppression path as `applySituationFeedback(situation, "not_task")` when a situation
  is resolvable via `smartSituationByTaskId`, and only fall back to plain removal for AI-extracted tasks with no
  situation. Also fix the fallback resurrection: `visibleSuggestionTasks` (`:391`) should filter smart-task fallbacks
  through the same dismissed-fingerprint set instead of switching wholesale between `extractedTasks` and smart tasks.
- **Duplicate feedback affordances on one card.** Each card can show *six* verdict buttons: Useful / Later /
  Too vague / Not a task (situation block, `:1186-1189`) plus Start this task / Not a task (card footer,
  `:1203-1218`). Collapse to one row: **Start**, **Later**, **Not a task**, with "Too vague"/"Useful" behind a small
  overflow ("More feedback"). Five choices is executive-function hostile in an app built for executive function.
- **"Clear suggestion cards" (`:1410`) only clears `extractedTasks`** — smart-situation fallbacks instantly refill
  the list, so the button appears broken. Same root cause as the resurrection bug; route it through feedback
  suppression or label it honestly ("Rebuild from current signals").
- **AI Review panel (`renderClaudeReviewPanel`, `:1097`)** mixes two unrelated tools (relevance cleanup + free-form
  Q&A) in one card with a long explanatory paragraph. The answer box has no clear/copy affordance and no history —
  a second question silently replaces the first. Minimum: add a clear button and show which engine answered
  (the server returns `engine`, the UI drops it at `:978`).
- **Stat trio at `:1385-1398` duplicates Today's cards** and its "Context only" tile is a computed subtraction that
  means little. One compact stat row is enough.

### 2.3 Inbox ("signals")

- **Paste-a-phone-item form placement is backwards** (`:1445-1491`): the manual-capture form sits *above* the actual
  inbox list, so the most common action (scan recent signals) is below a form most visits don't need. Collapse the
  form behind a "+ Add item" disclosure and lead with the signal list.
- **Note capture friction (feeds §3.3):** the form defaults `manualSignalSource` to `"sms"` (`:363`) — pasted
  personal notes get mislabeled as SMS in the telemetry archive unless the user remembers the dropdown. A dedicated
  one-tap "Quick note" (source `user_note`, single textarea) belongs on Today; the full source-picker form can stay
  on Inbox for true re-entry of missed items. Telemetry-positive: more owner notes get captured, correctly labeled.
- **No filtering or grouping:** `visibleSignals` is a flat, score-sorted list capped at 40 (`lifeopsRules.ts:329`).
  With seven sources interleaved, finding "that SMS from this morning" is scroll-and-squint. Add source filter chips
  (SMS / Notifications / Calendar / Screen text / Usage / Notes) — display-only filtering, zero capture impact.
- **Hidden data creates mistrust:** `displaySignals` drops score-<2 items and expired signals entirely, and
  `dedupeSignals` (`LifeOpsApp.tsx:136`) silently drops clinical-content matches. The Inbox header claims to show
  "raw phone material Sentinel can see" — it doesn't. Add a muted footer line: "N low-signal / expired items hidden —
  show" with an opt-in reveal. (Everything is still captured and exported; this is purely about the UI being honest.)
- **Signal cards have no actions.** You can read a signal but not act on it: no "Make this a task"
  (`buildTaskFromSignal` already exists), no "Hide" (suppression exists only via the audit flow), no "Copy". At
  minimum add "Suggest task from this" on task-candidate cards.

### 2.4 Current ("task")

- **Only one active task is reachable.** `activeTask = activeTasks.find(t => !t.isCompleted)` (`:375`) plus
  `approveTaskCandidate` *prepending* (`:642`) means accepting task B while task A is active makes A unreachable —
  invisible until B finishes, with no list, no switcher, no way to abandon or delete. Add a compact "Other tasks"
  drawer on Current (switch / mark done / drop) — the single-focus philosophy stays (one task rendered large), but
  hidden state disappears. Also: completed tasks accumulate in localStorage forever with no history view; a simple
  "Done today" collapsible would both fix the leak and give a satisfying end-of-day receipt.
- **Steps list allows out-of-order completion but the model doesn't** (`updateTaskStepState`, `:795`): tapping step 3
  marks it done and promotes step 4 to current, leaving steps 1-2 pending-but-skipped, and `nextPhysicalAction` then
  points past them. Either lock non-current steps or handle skip explicitly (mark earlier pending steps as skipped).
- **"Running late" is destructive with no undo** (`handleRunningLate`, `:829`): it permanently drops all but three
  unfinished steps and rescales durations. Add an undo (keep the pre-shrink task in state for one action) or make it
  a view-mode ("show essentials") rather than a mutation.
- **Time plan panel is passive** (`:1580-1589`): Prep starts / Leave by / Target render as static text; the
  urgency lives only in transient notices (`:550-565`, each window firing once). Show a live countdown chip on the
  Current header ("Leave in 24m") — the reverse-timeline data already exists via `generateReverseTimeline`.
- **Delay notes promise something the app doesn't do** (`:1604`: "you want future estimates to account for the hidden
  steps"; `handleCreateDelayNote` notice: "Future tasks should get a bigger buffer"). Nothing reads `slipAutopsies`
  ever again except the last-3 list. See §3.6.

### 2.5 Access

- **Strongest screen structurally** (clear per-permission cards with deep links, `:1639-1658`), two gaps:
- **No pipeline health.** The screen answers "can Android capture?" but not "is capture flowing?" — no last-export
  time, no worker status, no server reachability, no telemetry-store count. Add an "Export & server" card fed by (a)
  the extended bridge status JSON (§4.4) and (b) a `GET {askApiBase}/api/health` probe (endpoint already exists,
  `server.ts:774`; the UI never calls it). This is the UI half of top-5 item #1.
- **Desktop preview is a dead-end wall:** every button disabled with "Available on Android" (`:1654`). Fine, but the
  page could instead show the desktop-relevant equivalents: server health, `ingestAuthRequired`, store mode
  (`/api/telemetry` already returns `mode`/`dbPersistent`), and the configured `askApiBase`. Diagnostics JSON
  (`:1694-1698`) is good — keep it.
- The 10s bridge-status poll (`:544-548`) plus 45s telemetry sync run regardless of visible tab; pause polls via
  `document.visibilitychange` to save WebView battery (capture itself is native-side and unaffected — this only
  throttles *status reads* while backgrounded).

### 2.6 Modals

- Add Task and Delay modals are fine functionally; both would inherit consistency from a shared `Modal` + form
  primitives (§2.0). The steps textarea's `(10m)` duration syntax (`:869`) is undiscoverable — placeholder mentions it,
  but a live parse preview line ("3 steps, 25m total") would confirm it worked.
- Stuck panel (`:1738`) is excellent in intent; it should also offer "I can't do any of these → shrink further /
  switch task" instead of only listing the three steps.

### 2.7 God-component decomposition path

Current: ~1,860 lines, 30 `useState` + 2 refs in one component; every 30s clock tick re-renders the entire tree
(`currentClock` feeds `taskSignals`/`visibleSignals`/`smartSituations` memos at `:380-390`).

**Extract in this order (each step compiles and ships alone):**

1. **Leaf components (pure props):** `ActionButton`, `EmptyState` (already pure, `:190-223`) → `components/ui.tsx`;
   then `SignalCard` (`renderSignalCard`, `:1222`), `TaskSuggestionCard` (`renderTaskCard`, `:1147`),
   `RelevanceAuditPanel` (`:1047`), `AiReviewPanel` (`:1097`), `NoticeBanner`, `BottomNav`, `AppHeader`, and a shared
   `Modal`.
2. **Screen components:** `screens/TodayScreen.tsx`, `SuggestionsScreen.tsx`, `InboxScreen.tsx`,
   `CurrentTaskScreen.tsx`, `AccessScreen.tsx` — each receiving a narrow props contract, no direct localStorage.
3. **State: one reducer + two hooks.**
   - `useLifeOpsStore` — `useReducer` + context over the persisted domain state: `activeTasks`, `sentinelFeed`,
     `extractedTasks`, `signalFeedback`, `suppressedSignalIds`, `slipAutopsies`, `taskTargetOverrides`. Actions like
     `SIGNALS_MERGED`, `TASK_APPROVED`, `STEP_DONE`, `FEEDBACK_APPLIED`, `AUDIT_CLEARED` centralize today's scattered
     multi-setState choreography (e.g. `clearSelectedAuditItems` currently touches five state slices at `:744-786`).
     A `useEffect` per persisted slice keeps the existing `sentinel-lifeops:*` localStorage keys byte-compatible —
     **no storage migration, no telemetry impact**.
   - `useTelemetrySync(dispatch)` — owns the bridge/fetch plumbing: `syncTelemetryLogs`, `pushTelemetryExport`,
     `refreshAndroidStatus`, intervals, and the bridge type declaration (`:56-85`). This is the only module that talks
     to `window.SentinelAndroid` or `/api/*`.
   - Ephemeral UI state (modals, form fields, `askQuestion`, `selectedAuditIds`, `notice`) stays in local
     `useState` inside the owning screen/modal — it does not belong in the store.
4. **Derived data:** move `dedupeSignals`, `formatRelativeTime`, `sourceLabel`, `sourceIcon`,
   `compact*ForClaudeCheck`, `buildLocalAskAnswer` (`:87-326`) into `src/lib/` modules so they become unit-testable.
   Wrap each screen in `React.memo` and pass `nowEpochMillis` down instead of the `Date` object so the 30s tick only
   re-renders time-sensitive leaves.

Target: `LifeOpsApp.tsx` ≤ ~150 lines (providers, tab switch, layout). No behavior change, no capture change.

---

## 3. Functional findings

### 3.1 Export status visibility (pipeline observability) — the biggest gap

Evidence: `pushTelemetryExport` (`LifeOpsApp.tsx:431`) reports success only as a string glued into a transient
notice; failures surface **only when `forceRefresh` is true** (`:467-474`) — the every-45s background export fails
silently. `TelemetryExportWorker.doWork` (`TelemetryExportWorker.java:29`) logs to logcat only.
`getBridgeStatusJson` (`SentinelBridge.java:88`) exposes permissions but no export state.

Proposal (all additive, telemetry-safe):
- In `SentinelBridge.exportTelemetrySnapshot` (`SentinelBridge.java:163`), after every attempt write
  `last_export_at`, `last_export_status`, `last_export_count`, `last_export_error` to the existing `PREFS`
  (alongside `saveExportConfig`, `:1129`), and include them + `exportConfigSaved: bool` in `getBridgeStatusJson`.
  Worker and foreground exports share this path automatically since both call `exportTelemetrySnapshot`.
- In `TelemetryExportWorker`, also record `last_worker_run_at` / `last_worker_result` so the UI can distinguish
  "worker never ran" from "worker ran, nothing to send".
- Web UI: Access-screen "Export & server" card (§2.5) + a small status dot in the header (green: exported <60m ago;
  amber: stale; red: last export errored).

### 3.2 Background worker health & robustness

- `TelemetryExportWorker` skips forever until one foreground export succeeds (`savedExportBaseUrl` empty →
  `Result.success()`, `TelemetryExportWorker.java:33-36`). Reasonable bootstrap, but invisible — the UI should show
  "background export not armed yet — open the app on WiFi once" until `exportConfigSaved` is true (needs §3.1).
- `Result.retry()` uses default backoff; fine, but repeated retries are indistinguishable from success without §3.1.
- No `WorkManager` constraint issue found; `ExistingPeriodicWorkPolicy.UPDATE` (`MainActivity.java:109`) is correct.
- Consider `getWorkInfosForUniqueWork("lifeops-telemetry-export")` surfaced through a new bridge method
  (`getExportWorkerStatusJson`) for exact WorkManager state (ENQUEUED/RUNNING/last run) — optional, prefs
  timestamps from §3.1 cover 90% of the need.

### 3.3 On-device capture retention (telemetry-fidelity improvement)

- `SentinelNotificationListenerService.MAX_RECENT = 30` (`:18`) and `SentinelAccessibilityService.MAX_RECENT = 12`
  (`:19`) are in-memory rings. Between 30-minute worker runs, a chatty hour (group chats, media notifications)
  evicts real notifications before export; process death (WebView OOM on the 16GB-adjacent phone reality) loses the
  entire buffer. Proposal: append-persist both rings to app-private storage (simple JSONL file or SharedPreferences
  like `CUSTOM_LOGS`) with a few-hundred-entry cap, load on service (re)connect, and let `getTelemetryJson` read the
  persisted set. Strictly *more* capture reaches CBT.
- Custom notes cap: `addTelemetryJson` keeps only 40 custom logs (`SentinelBridge.java:246`) — owner notes older
  than the newest 40 stop being exported (the server keeps what it already received, but a fresh server store never
  gets them again). Raise the cap materially (they're tiny) — user notes are first-class telemetry.
- `addTelemetryJson` ignores a caller-supplied `capturedAtEpochMillis` and stamps `System.currentTimeMillis()`
  (`:237-242`) — back-dated manual entries ("this SMS was from yesterday") lose their true time. Honor the payload
  value when present.

### 3.4 Task/suggestion lifecycle gaps

- **AI extraction results are effectively discarded.** In `handleExtractTasks` (`LifeOpsApp.tsx:567-620`):
  `const nextTasks = fallbackTasks.length > 0 ? fallbackTasks : parsedTasks;` — the local smart/heuristic tasks
  *override* the just-fetched Claude/bridge extraction whenever they're non-empty, which is nearly always. So the
  server round-trip to `/api/extract-tasks` (and the Android `extractTasksJson` call) is dead weight in the common
  path. Decide the intended precedence (likely: parsed AI tasks first, local as fallback — the inverse of today) or
  merge with dedupe; either way the current code contradicts the button's "AI" framing.
- **Dismissal split brain + fallback resurrection** — see §2.2; the fix is state-level (route all dismissals through
  fingerprint feedback) and belongs with the reducer work in §2.7.
- **Multiple active tasks unreachable / no abandon** — see §2.4.
- **Suppression sets grow unboundedly:** `suppressedSignalIds` and `signalFeedback` records are never pruned
  (`:343-344`, persisted at `:535-536`). Prune entries older than ~30 days on load (display-layer only; captured
  telemetry untouched).

### 3.5 Dedupe / noise handling

- **Screen-text near-duplicates flood the archive.** `SentinelAccessibilityService.captureForegroundSnapshot`
  suppresses an identical snapshot only within the 5s poll window (`lastSnapshotKey` + `POLL_INTERVAL_MS` check,
  `:76-82`); the same static screen re-captured minutes apart produces new ids (`android-accessibility-<now>`) with
  identical content, which the id-keyed stores (`server.ts:872`, Postgres upsert) treat as distinct rows. Proposal:
  keep the key comparison but drop the time window for *exact* content matches per package (any content change still
  captures immediately — fidelity preserved, redundancy removed). If CBT wants dwell information, bump a
  `metadata.repeatCount` on the retained log instead of duplicating rows (shape-preserving: `metadata` is already in
  the contract).
- **Unknown sources are silently mislabeled as `notification`** in `sanitizeTelemetryPayload` (`server.ts:620`) and
  `normalizeSignal` (`lifeopsRules.ts:293-295`). Coercion is contract-safe, but add a `metadata.originalSource` when
  coercing so no information is destroyed (additive, telemetry-positive).
- Web-side `dedupeSignals` id fallback key `source:title:content` (`LifeOpsApp.tsx:141`) can merge two *different*
  same-text events (e.g. identical "On my way" SMS twice in a day) in the *display* layer. Include
  `capturedAtEpochMillis` in the fallback key. (Capture/export unaffected — ids from Android are unique.)

### 3.6 Daily-driver capabilities worth adding

- **Delay notes should feed estimates.** `slipAutopsies` are captured (`:987-1009`) and never consumed. Cheap,
  honest version: compute the median `actual/expected` ratio and (a) show it on the Add Task modal ("your 15m tasks
  average 27m"), (b) apply it to `generateReverseTimeline`'s prep budget as an optional "realistic mode". Makes an
  existing capture loop actually pay off.
- **Server-side archive access (shape-preserving).** `GET /api/telemetry` serves only the 500-record in-memory
  window (`server.ts:815-828`) even when Postgres holds the full archive. Support optional
  `?since=<epochMillis>&limit=` query params that read from `loadTelemetryLogsFromDb` and still return
  `{logs:[...]}` in the identical shape — CBT's strict validation is unaffected (params are opt-in; default behavior
  byte-identical). Enables CBT backfills after its own downtime without contract change.
- **Bulk-export ack should not depend on transient notices.** The every-45s foreground export re-sends the full
  snapshot (fine — full snapshots are the telemetry-safe choice given the server's 500-cap merge in
  `server.ts:848-886`), but the UI should record last success/fail like §3.1 rather than only stringing it into
  the sync notice.
- **`/api/health` in the UI** — provider, `modelRuntimeStatus`, `claudeLastError` are all served (`server.ts:774-792`)
  and never displayed; the "AI check didn't run" mystery in the Suggested tab would self-explain with a one-line
  provider status in the AI Review panel.

---

## 4. Architecture / quality

### 4.1 `server.ts` decomposition plan (~1,120 lines → ~6 modules)

Keep `server.ts` as composition root (~100 lines: dotenv/BOM fixup, express wiring, vite/static, `start()`).
Extract, in dependency order:

1. `src/server/config.ts` — env parsing: PORT/host/data-dir, provider constants (`server.ts:59-81`),
   `normalizeBomPrefixedEnvKeys` (`:28-39`).
2. `src/server/security.ts` — `constantTimeEquals`, `requestHasValidIngestToken`, `isLoopbackRequest`,
   `getAllowedOrigin` (`:107-128`, `:514-543`) + an express middleware `requireIngestTokenOrLoopback` so the
   guard clause repeated in 7 route handlers becomes one line.
3. `src/server/telemetryStore.ts` — `sanitizeTelemetryPayload`, `sanitizeLoadedTelemetryLogs`, `loadTelemetryLogs`,
   `persistTelemetryLogs` (atomic write + backup), `persistTelemetryLogsToDbAsync`, `hydrateTelemetryFromDb`, and the
   `globalTelemetryLogs` mutation behind `insertLog`/`mergeBulk` functions (`:545-650`, `:1041-1058`). This is the
   contract-critical module — extracting it makes the frozen shape unit-testable (§4.3).
4. `src/server/aiProviders.ts` — DeepSeek fetch, Anthropic SDK leg, Claude Code CLI spawn, provider ordering and
   status bookkeeping (`:130-510`). The `claudeLast*` module-level mutables become a small `ProviderStatus` object.
5. `src/server/routes/telemetry.ts` and `src/server/routes/ai.ts` — the seven route handlers, thin over 3+4.
6. `src/server/heuristics.ts` — `parseCommitmentHeuristic`, `localAskLifeOpsAnswer`, `sanitizeClaudeAuditItems`
   (`:652-772`) (or fold into existing `src/lifeopsRules.ts`/`decisionEngine.ts` where they overlap).

No route paths, response shapes, or storage formats change. Each module lands separately with tests.

### 4.2 Duplicated TS/Java heuristic engine — drift is real, not theoretical

`SentinelBridge.java:636` says "Mirrors src/lifeopsRules.ts. Update the TS fixtures and this Java mirror together."
Observed divergences today:

- **Promo/noise penalty:** TS `scoreSignal` (`lifeopsRules.ts:272`) penalizes
  `\b(ad|sale|promo|newsletter|download|updated|playing|screen time summary)\b`; Java (`SentinelBridge.java:708`)
  uses `containsAny` with `{" ad ", " sale ", " promo", "newsletter", "weather", "battery", "download", "updated",
  "playing", "screen time summary"}` — Java additionally penalizes weather/battery (double-counting the noise gate),
  and space-padded `contains` misses "ad"/"sale" at string boundaries where the TS word-boundary regex matches.
- **System-usage filter inputs:** TS `isSystemAppUsageSignal` (`lifeopsRules.ts:91`) matches over
  `packageName + title + content` and includes the bare word `sentinel` and `webview`; Java `relevanceScore` calls
  `isIgnoredUsagePackage("", title + content)` (`:697`) — never passing the actual packageName — and its pattern
  (`:920`) has `sentinellifeops`/`webview` but not bare `sentinel`.
- **Reason strings** differ for the score≥5 / score≥3 tiers (`lifeopsRules.ts:287-289` vs
  `SentinelBridge.java:730-733`), so the same signal explains itself differently depending on which side ranked it.

Impact: the WebView-offline path (Android `rankLogs`/`extractTasksJson`) and desktop/server path can rank the same
telemetry differently — confusing UX and untrustworthy tests. Options:

- **Recommended (telemetry-safe, incremental): golden fixture parity harness.** Create
  `src/fixtures/heuristic-cases.json` — an array of `{signal, expectedScore, expectedTaskCandidate, expectedTitle}` —
  consumed by a vitest suite *and* a plain JUnit test in `android-lifeops` (the scoring code is pure Java; no
  Android test infra needed beyond a `test` source set, which currently does not exist at all). Drift fails CI.
  Fix the three divergences above as the first fixture-driven commits.
- **Longer term:** shrink the Java mirror's job. The Java heuristics exist for (a) offline ranking in
  `rankLogs`/`getTelemetryJson` and (b) `extractTasksJson` when the WebView can't reach the server. Since the WebView
  always ships the TS bundle, the web layer could do all ranking client-side from raw logs and the bridge could stop
  scoring entirely — **but** `relevanceScore`/`relevanceReason` currently ride along in the exported contract fields,
  so keep the mirror (with the parity harness) until CBT confirms it recomputes relevance itself. Do not remove any
  Java capture code.

### 4.3 Test coverage gaps worth closing (named modules)

Existing: `lifeopsRules.test.ts` (solid scoring/expiry coverage), `decisionEngine.test.ts` (clustering, feedback,
audit), `telemetryDb.test.ts` (lazy env, no-op mode), `cartographer.test.ts` (thin). Gaps, in value order:

1. **`server.ts` telemetry contract** (after §4.1 step 3): `sanitizeTelemetryPayload` — source coercion, field
   trimming/limits, `preserveClientFields` id/timestamp preservation, metadata passthrough; bulk merge —
   id-dedupe, newest-first sort, 500 cap; `loadTelemetryLogs` backup recovery. This is the code guarding the frozen
   CBT contract and it has zero tests.
2. **`server.ts` auth/CORS**: `requestHasValidIngestToken` (empty-token fail-closed + loopback pass,
   `x-forwarded-for` spoof rejection in `isLoopbackRequest`), `getAllowedOrigin` allowlist logic.
3. **`aiProviders` ordering**: `claudeProviderOrder`/`getConfiguredProvider` matrix (deepseek/managed/sdk/none) and
   `extractJsonArray` fence-stripping — cheap pure-function tests.
4. **`cartographer.generateReverseTimeline`**: midnight-crossing case the code comments about (`cartographer.ts:113`),
   prep-start accumulation, done-step handling — current test file is 1KB and misses these.
5. **UI logic after decomposition**: reducer actions (`TASK_APPROVED`, `AUDIT_CLEARED` fan-out), `dedupeSignals`,
   the dismissal/fingerprint path from §2.2 — impossible to test today inside the god component, trivial after §2.7.
6. **Java parity suite** per §4.2 (also the first tests the Android module has ever had).

### 4.4 Android shell improvements (all capture-preserving)

- **Bridge status JSON additions** (§3.1): `lastExportAt`, `lastExportStatus`, `lastExportCount`, `lastExportError`,
  `lastWorkerRunAt`, `exportConfigSaved`. Purely additive keys; the web UI's flag-list renderer already filters to
  known keys (`LifeOpsApp.tsx:1666-1677`) so nothing breaks.
- **Persist listener/accessibility ring buffers** (§3.3) — the highest-fidelity single change on the phone side.
- **`SentinelBridge` (≈1,235 lines) decomposition** mirroring the server plan: `collectors/` (Sms, CallLog, Calendar,
  Usage, Location readers — `appendSmsLogs` etc., `:374-554`), `HeuristicEngine.java` (everything from `taskFromSignal`
  down to `inferTargetTime`, `:637-1016` — also the unit under the parity harness), `TelemetryExporter.java`
  (`exportTelemetrySnapshot`, allowlist, HTTP, prefs `:163-231`, `:1129-1216`), leaving `SentinelBridge` as the thin
  `@JavascriptInterface` facade. No behavior change; makes the JUnit parity suite natural.
- **`isAllowedExportTarget` fail-open** (`SentinelBridge.java:1168-1184`): on URL-parse failure it *allows* the
  export. Documented as intentional ("never silently drop a real export") — telemetry-positive as-is; just log the
  exception so a misconfigured target is visible. Note it alongside the deferred security items rather than changing
  behavior unilaterally.
- **Battery**: pause the WebView's 10s status poll when hidden (§2.5). Do **not** touch the accessibility 5s poll or
  notification listener — those are capture.

---

## 5. Sequenced roadmap

### Phase A — Quick wins (< 1h each)

| # | Item | Where | Depends on |
|---|------|-------|-----------|
| A1 | Persist + expose `lastExportAt/Status/Count/Error`, `lastWorkerRunAt`, `exportConfigSaved` in bridge status JSON | `SentinelBridge.exportTelemetrySnapshot`, `TelemetryExportWorker.doWork`, `getBridgeStatusJson` | — |
| A2 | Card-level "Not a task" routes through fingerprint suppression when a situation exists | `LifeOpsApp.tsx:1211` + `applySituationFeedback` | — |
| A3 | Unify screen naming (Inbox/Suggestions/Current Task/Access) across nav, headers, cross-links | `LifeOpsApp.tsx` strings | — |
| A4 | `isSyncing` state + spinner/disabled on all Refresh buttons | `syncTelemetryLogs` callers | — |
| A5 | Notice polish: auto-dismiss `info`, errors not overwritten by periodic sync, `aria-live` | notice banner `:1271` | — |
| A6 | Quick-note button on Today (source `user_note`); Inbox form default source → `user_note` | Today screen, `handleAddManualSignal` | — |
| A7 | Safe-area insets (`viewport-fit=cover`, `env(safe-area-inset-*)`), shrink `pb-56`/`bottom-12`/`pt-10` | `index.html`, header/nav/main | — |
| A8 | Honor caller `capturedAtEpochMillis` in `addTelemetryJson`; raise custom-note cap (40 → 200) | `SentinelBridge.java:237-247` | — |
| A9 | Fix the three known TS/Java heuristic divergences (promo list, usage-filter inputs, reason tiers) | `SentinelBridge.java:697-733` | — |
| A10 | Show `engine` label on Ask answers + surface `/api/health` provider status in AI Review panel | `handleAskSentinel`, AI panel | — |

### Phase B — Medium (about half a day each)

| # | Item | Depends on |
|---|------|-----------|
| B1 | "Export & server" health card on Access + header status dot (worker armed / last export / server health) | A1 |
| B2 | God-component decomposition steps 1-2 (leaf components + 5 screen files, shared Modal/inputs on tokens) | A3 helps |
| B3 | Decomposition steps 3-4: `useLifeOpsStore` reducer + `useTelemetrySync`; fix fallback-resurrection & "Clear suggestion cards" inside the reducer; prune stale suppression/feedback entries | B2, A2 |
| B4 | `server.ts` split into config/security/telemetryStore/aiProviders/routes | — |
| B5 | Tests: telemetry contract + auth/CORS (+ provider ordering, cartographer midnight cases) | B4 |
| B6 | Golden-fixture parity harness (`heuristic-cases.json` + vitest + JUnit source set in android-lifeops) | A9 |
| B7 | Persist notification/screen-text ring buffers to app-private storage; raise caps (capture-fidelity) | — |
| B8 | Inbox improvements: source filter chips, hidden-items reveal footer, form behind disclosure, per-signal "Suggest task" | B2 |
| B9 | Current-task lifecycle: other-tasks drawer (switch/abandon), done-today history, step-skip semantics, Running-late undo | B3 |
| B10 | Resolve AI-extraction precedence inversion in `handleExtractTasks` (parsed results first or merged) | B3 |

### Phase C — Large (multi-day)

| # | Item | Depends on |
|---|------|-----------|
| C1 | `SentinelBridge` decomposition (collectors / HeuristicEngine / TelemetryExporter facade) with parity suite green before+after | B6 |
| C2 | Screen-text exact-content dedupe with `metadata.repeatCount` (shape-preserving; coordinate with CBT read side) | B7 |
| C3 | Shape-preserving Postgres paging on `GET /api/telemetry` (`?since/limit`) + CBT backfill validation | B4, B5 |
| C4 | Delay-notes → estimate calibration ("realistic mode" in reverse timeline + Add Task hint) | B3, B9 |
| C5 | Today-screen redesign around "one next action" (inline top suggestions, countdown chip, deduped chrome) | B2, B3, B9 |
| C6 | Deferred security batch (owner-scheduled): token rotation + history purge, deployed bind-host, Android network-security-config replacing `usesCleartextTraffic` | owner approval |

**Dependency spine:** A1 → B1 (export health), A9 → B6 → C1 (heuristic parity), B2 → B3 → {B8, B9, B10, C4, C5}
(decomposition unlocks the UX fixes), B4 → B5 → C3 (server split unlocks contract tests and paging).

---

*Analysis only — no repo files were modified; this report is the sole write. No file deletions are proposed anywhere;
all retention-related items are additive. Every recommendation was checked against the telemetry hard rule: capture
paths (listeners, collectors, exports, stores) are only ever extended, never narrowed.*
