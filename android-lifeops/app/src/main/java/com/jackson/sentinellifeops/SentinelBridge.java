package com.jackson.sentinellifeops;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.provider.CallLog;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.provider.Telephony;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SentinelBridge {
    private static final int MAX_LOGS = 220;
    private static final int MAX_SMS_LOGS = 40;
    private static final int MAX_CALL_LOGS = 30;
    private static final int MAX_CALENDAR_LOGS = 16;
    private static final int MAX_USAGE_LOGS = 48;
    private static final long TELEMETRY_CACHE_MS = 45000L;
    private static final long REFRESH_LOOKBACK_MS = 1000L * 60L * 60L * 24L;
    private static final long CALENDAR_LOOKAHEAD_MS = 1000L * 60L * 60L * 24L * 14L;
    private static final long EXPIRED_SIGNAL_GRACE_MS = 1000L * 60L * 90L;
    // Mirrors MainActivity.LIFEOPS_API_HOST. Keep the two in sync.
    private static final String LIFEOPS_API_HOST = "sentinel-lifeops-api.onrender.com";
    private static final String PREFS = "sentinel_lifeops_bridge";
    private static final String CUSTOM_LOGS = "custom_logs";
    private static final SimpleDateFormat TIME_FORMAT = new SimpleDateFormat("hh:mm a", Locale.US);
    private static final SimpleDateFormat TARGET_TIME_FORMAT = new SimpleDateFormat("HH:mm", Locale.US);
    private static final SimpleDateFormat DATE_FORMAT = new SimpleDateFormat("yyyy-MM-dd", Locale.US);

    // Monotonic counter so two logs whose (title+content) share a hashCode still get
    // distinct ids and are not silently de-duplicated by the ingest store.
    private static final AtomicLong LOG_ID_SEQUENCE = new AtomicLong(0L);

    private final Context context;
    private final MainActivity activity;
    private long cachedTelemetryAt = 0L;
    private String cachedTelemetryJson = null;

    SentinelBridge(MainActivity activity) {
        this.context = activity.getApplicationContext();
        this.activity = activity;
    }

    SentinelBridge(Context context) {
        this.context = context.getApplicationContext();
        this.activity = null;
    }

    @JavascriptInterface
    public String getBridgeStatusJson() {
        JSONObject status = new JSONObject();
        try {
            status.put("bridge", "android-native");
            status.put("packageName", context.getPackageName());
            status.put("sms", has(Manifest.permission.READ_SMS));
            status.put("callLog", has(Manifest.permission.READ_CALL_LOG));
            status.put("contacts", has(Manifest.permission.READ_CONTACTS));
            status.put("calendar", has(Manifest.permission.READ_CALENDAR));
            status.put("coarseLocation", has(Manifest.permission.ACCESS_COARSE_LOCATION));
            status.put("fineLocation", has(Manifest.permission.ACCESS_FINE_LOCATION));
            status.put("usageAccess", hasUsageAccess());
            status.put("notificationListener", isEnabledSetting("enabled_notification_listeners"));
            status.put("accessibility", isEnabledSetting(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES));
            status.put("timestamp", new Date().toString());
        } catch (Exception e) {
            return errorJson(e);
        }
        return status.toString();
    }

    @JavascriptInterface
    public synchronized String getTelemetryJson() {
        return getTelemetryJson(false);
    }

    @JavascriptInterface
    public synchronized String refreshTelemetryJson() {
        return getTelemetryJson(true);
    }

    @JavascriptInterface
    public synchronized String exportTelemetrySnapshotJson(String baseUrl, String token, boolean forceRefresh) {
        try {
            return exportTelemetrySnapshot(baseUrl, token, forceRefresh).toString();
        } catch (Exception e) {
            return errorJson(e);
        }
    }

    private String getTelemetryJson(boolean forceRefresh) {
        long now = System.currentTimeMillis();
        if (!forceRefresh && cachedTelemetryJson != null && now - cachedTelemetryAt < TELEMETRY_CACHE_MS) {
            return cachedTelemetryJson;
        }

        JSONArray logs = new JSONArray();
        long since = now - REFRESH_LOOKBACK_MS;
        appendArray(logs, getCustomLogs());
        appendArray(logs, SentinelNotificationListenerService.activeNotificationLogs());
        appendArray(logs, SentinelNotificationListenerService.recentLogs());
        appendArray(logs, SentinelAccessibilityService.activeWindowLog());
        appendArray(logs, SentinelAccessibilityService.recentLogs());
        appendSmsLogs(logs, since);
        appendCallLogs(logs, since);
        appendCalendarLogs(logs, since, now + CALENDAR_LOOKAHEAD_MS);
        appendUsageLogs(logs, since);
        appendLocationLog(logs);

        JSONObject out = new JSONObject();
        try {
            out.put("logs", rankLogs(logs));
            out.put("mode", "android-native-bridge");
            out.put("lookbackHours", 24);
            out.put("historyCoverage", "SMS, call log, calendar, and app usage are queried over the last 24 hours. Notifications and screen text are live/recent from Android listeners only.");
            out.put("persistent", true);
            out.put("permissions", new JSONObject(getBridgeStatusJson()));
        } catch (Exception e) {
            return errorJson(e);
        }
        cachedTelemetryJson = out.toString();
        cachedTelemetryAt = now;
        return cachedTelemetryJson;
    }

    JSONObject exportTelemetrySnapshot(String baseUrl, String token, boolean forceRefresh) throws Exception {
        String cleanBaseUrl = normalizeBaseUrl(baseUrl);
        if (cleanBaseUrl.isEmpty()) {
            return new JSONObject()
                    .put("success", false)
                    .put("error", "Missing LifeOps ingest base URL");
        }

        JSONObject telemetry = new JSONObject(getTelemetryJson(forceRefresh));
        JSONArray logs = telemetry.optJSONArray("logs");
        int count = logs == null ? 0 : logs.length();
        if (count <= 0) {
            return new JSONObject()
                    .put("success", false)
                    .put("error", "No telemetry logs available to export")
                    .put("exported", 0);
        }

        JSONObject payload = new JSONObject()
                .put("logs", logs)
                .put("mode", "android-native-export")
                .put("source", "android-broadcast-or-bridge")
                .put("packageName", context.getPackageName());

        String endpoint = cleanBaseUrl + "/api/telemetry/bulk";
        if (!isAllowedExportTarget(endpoint)) {
            return new JSONObject()
                    .put("success", false)
                    .put("error", "blocked target");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            String cleanToken = token == null ? "" : token.trim();
            if (!cleanToken.isEmpty()) {
                connection.setRequestProperty("X-Sentinel-Ingest-Token", cleanToken);
            }

            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body);
            }

            int status = connection.getResponseCode();
            String responseBody = readResponseBody(connection, status);
            JSONObject result = new JSONObject()
                    .put("success", status >= 200 && status < 300)
                    .put("status", status)
                    .put("exported", count)
                    .put("endpoint", endpoint)
                    .put("body", responseBody);
            if (status < 200 || status >= 300) {
                result.put("error", "LifeOps ingest returned HTTP " + status);
            }
            return result;
        } finally {
            connection.disconnect();
        }
    }

    @JavascriptInterface
    public String addTelemetryJson(String payloadJson) {
        try {
            JSONObject payload = new JSONObject(payloadJson);
            JSONObject log = createLog(
                    payload.optString("source", "user_note"),
                    payload.optString("title", "Manual phone action"),
                    payload.optString("content", ""),
                    System.currentTimeMillis()
            );
            JSONArray logs = getCustomLogs();
            JSONArray next = new JSONArray();
            next.put(log);
            for (int i = 0; i < logs.length() && i < 40; i++) {
                next.put(logs.getJSONObject(i));
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(CUSTOM_LOGS, next.toString())
                    .apply();
            cachedTelemetryJson = null;
            cachedTelemetryAt = 0L;
            return new JSONObject().put("success", true).put("log", log).toString();
        } catch (Exception e) {
            return errorJson(e);
        }
    }

    @JavascriptInterface
    public String parseCommitmentJson(String message) {
        try {
            String lower = message == null ? "" : message.toLowerCase(Locale.US);
            String time = "16:00";
            String title = "Commitment Plan";
            String confidence = "medium";
            String status = "tentative";
            String action = "ask user";

            Matcher matcher = Pattern.compile("\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b").matcher(lower);
            if (matcher.find()) {
                int hour = Integer.parseInt(matcher.group(1));
                String minute = matcher.group(2) == null ? "00" : matcher.group(2);
                String suffix = matcher.group(3);
                if ("pm".equals(suffix) && hour < 12) hour += 12;
                if ("am".equals(suffix) && hour == 12) hour = 0;
                time = String.format(Locale.US, "%02d:%s", hour, minute);
                confidence = "high";
            }

            if (lower.contains("cancel") || lower.contains("never mind") || lower.contains("don't come")) {
                title = "Canceled Commitment";
                status = "canceled";
                action = "cancel existing event";
                confidence = "high";
            } else if (lower.contains("call")) {
                title = "Call Commitment";
                action = "add to calendar";
            } else if (lower.contains("rent") || lower.contains("suv") || lower.contains("van")) {
                title = "Vehicle Rental Commitment";
            } else if (lower.contains("meet") || lower.contains("see you")) {
                title = "Meeting Commitment";
            }

            JSONObject anchor = new JSONObject();
            anchor.put("title", title);
            anchor.put("person", JSONObject.NULL);
            anchor.put("raw_excerpt", message == null ? "" : message);
            anchor.put("inferred_date", DATE_FORMAT.format(new Date()));
            anchor.put("inferred_time", time);
            anchor.put("location", "Unspecified");
            anchor.put("confidence", confidence);
            anchor.put("status", status);
            anchor.put("needs_confirmation", !"high".equals(confidence));
            anchor.put("recommended_action", action);

            return new JSONObject()
                    .put("results", new JSONArray().put(anchor))
                    .put("engine", "android-native-heuristic")
                    .toString();
        } catch (Exception e) {
            return errorJson(e);
        }
    }

    @JavascriptInterface
    public String extractTasksJson(String logsJson) {
        try {
            JSONArray logs = rankLogs(new JSONArray(logsJson == null ? "[]" : logsJson));
            JSONArray tasks = new JSONArray();
            List<String> seenTitles = new ArrayList<>();

            for (int i = 0; i < logs.length() && tasks.length() < 4; i++) {
                JSONObject log = logs.optJSONObject(i);
                if (log == null || log.optInt("relevanceScore", 0) < 3) continue;
                JSONObject task = taskFromSignal(log);
                if (task == null) continue;
                String title = task.optString("title").toLowerCase(Locale.US);
                if (seenTitles.contains(title)) continue;
                seenTitles.add(title);
                tasks.put(task);
            }

            return new JSONObject()
                    .put("results", tasks)
                    .put("engine", "android-native-heuristic")
                    .toString();
        } catch (Exception e) {
            return errorJson(e);
        }
    }

    @JavascriptInterface
    public void requestRuntimePermissions() {
        if (activity != null) {
            activity.runOnUiThread(activity::requestCorePermissions);
        }
    }

    @JavascriptInterface
    public void openUsageAccessSettings() {
        openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS);
    }

    @JavascriptInterface
    public void openNotificationAccessSettings() {
        openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
    }

    @JavascriptInterface
    public void openAccessibilitySettings() {
        openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS);
    }

    @JavascriptInterface
    public void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private void appendSmsLogs(JSONArray logs, long sinceEpochMillis) {
        if (!has(Manifest.permission.READ_SMS)) return;
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    Telephony.Sms.CONTENT_URI,
                    new String[]{Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE},
                    Telephony.Sms.DATE + " >= ?",
                    new String[]{String.valueOf(sinceEpochMillis)},
                    Telephony.Sms.DATE + " DESC"
            );
            int count = 0;
            int attempted = 0;
            while (cursor != null && cursor.moveToNext() && count < MAX_SMS_LOGS && logs.length() < MAX_LOGS) {
                // AND-10: isolate each row so one malformed SMS is skipped, not the whole batch.
                attempted++;
                try {
                    long id = cursor.getLong(0);
                    String address = cursor.getString(1);
                    String body = cursor.getString(2);
                    long date = cursor.getLong(3);
                    logs.put(createLog("sms", "SMS from " + labelForNumber(address), body, date).put("id", "android-sms-" + id));
                    count++;
                } catch (Exception perRow) {
                    // Skip this single SMS row and keep reading the cursor.
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void appendCallLogs(JSONArray logs, long sinceEpochMillis) {
        if (!has(Manifest.permission.READ_CALL_LOG)) return;
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CallLog.Calls.CONTENT_URI,
                    new String[]{CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION},
                    CallLog.Calls.DATE + " >= ?",
                    new String[]{String.valueOf(sinceEpochMillis)},
                    CallLog.Calls.DATE + " DESC"
            );
            int count = 0;
            int attempted = 0;
            while (cursor != null && cursor.moveToNext() && count < MAX_CALL_LOGS && logs.length() < MAX_LOGS) {
                // AND-10: isolate each row so one malformed call record is skipped, not the whole batch.
                attempted++;
                try {
                    long id = cursor.getLong(0);
                    String number = cursor.getString(1);
                    int type = cursor.getInt(2);
                    long date = cursor.getLong(3);
                    long duration = cursor.getLong(4);
                    String callType = type == CallLog.Calls.INCOMING_TYPE ? "Incoming" : type == CallLog.Calls.OUTGOING_TYPE ? "Outgoing" : "Missed";
                    logs.put(createLog("notification", callType + " call: " + labelForNumber(number), "Duration: " + duration + " seconds", date).put("id", "android-call-" + id));
                    count++;
                } catch (Exception perRow) {
                    // Skip this single call-log row and keep reading the cursor.
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void appendCalendarLogs(JSONArray logs, long sinceEpochMillis, long untilEpochMillis) {
        if (!has(Manifest.permission.READ_CALENDAR)) return;
        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    CalendarContract.Events.CONTENT_URI,
                    new String[]{CalendarContract.Events._ID, CalendarContract.Events.TITLE, CalendarContract.Events.EVENT_LOCATION, CalendarContract.Events.DTSTART},
                    CalendarContract.Events.DTSTART + " BETWEEN ? AND ?",
                    new String[]{String.valueOf(sinceEpochMillis), String.valueOf(untilEpochMillis)},
                    CalendarContract.Events.DTSTART + " ASC"
            );
            int count = 0;
            while (cursor != null && cursor.moveToNext() && count < MAX_CALENDAR_LOGS && logs.length() < MAX_LOGS) {
                long id = cursor.getLong(0);
                String title = cursor.getString(1);
                String location = cursor.getString(2);
                long start = cursor.getLong(3);
                logs.put(createLog("calendar", "Calendar: " + safe(title, "Untitled event"), "Location: " + safe(location, "Unspecified"), start).put("id", "android-calendar-" + id));
                count++;
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void appendUsageLogs(JSONArray logs, long sinceEpochMillis) {
        if (!hasUsageAccess()) return;
        try {
            UsageStatsManager manager = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            List<UsageStats> stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, sinceEpochMillis, now);
            if (stats == null) return;
            Map<String, JSONObject> foregroundMetadata = foregroundMetadataByPackage(manager, sinceEpochMillis, now);
            Collections.sort(stats, Comparator.comparingLong(UsageStats::getTotalTimeInForeground).reversed());
            int count = 0;
            for (UsageStats stat : stats) {
                if (count >= MAX_USAGE_LOGS || logs.length() >= MAX_LOGS) break;
                if (stat.getTotalTimeInForeground() <= 0) continue;
                String label = labelForPackage(stat.getPackageName());
                if (isIgnoredUsagePackage(stat.getPackageName(), label)) continue;
                long minutes = Math.max(1, stat.getTotalTimeInForeground() / 60000L);
                logs.put(createLog("app_usage", "App usage: " + label, minutes + " minutes foreground in the last 24 hours", stat.getLastTimeUsed())
                        .put("id", "android-usage-" + stat.getPackageName())
                        .put("packageName", stat.getPackageName())
                        .put("metadata", foregroundMetadata.containsKey(stat.getPackageName())
                                ? foregroundMetadata.get(stat.getPackageName())
                                : emptyForegroundMetadata(sinceEpochMillis, now)));
                count++;
            }
        } catch (Exception ignored) {
        }
    }

    private Map<String, JSONObject> foregroundMetadataByPackage(UsageStatsManager manager, long sinceEpochMillis, long now) throws Exception {
        Map<String, JSONObject> metadataByPackage = new HashMap<>();
        UsageEvents events = manager.queryEvents(sinceEpochMillis, now);
        if (events == null) {
            return metadataByPackage;
        }

        UsageEvents.Event event = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() != UsageEvents.Event.MOVE_TO_FOREGROUND || event.getPackageName() == null) {
                continue;
            }
            JSONObject metadata = metadataByPackage.get(event.getPackageName());
            if (metadata == null) {
                metadata = emptyForegroundMetadata(sinceEpochMillis, now);
                metadataByPackage.put(event.getPackageName(), metadata);
            }
            JSONArray timestamps = metadata.optJSONArray("foregroundTimestamps");
            metadata.put("foregroundCount", metadata.optInt("foregroundCount", 0) + 1);
            if (timestamps != null && timestamps.length() < 120) {
                timestamps.put(event.getTimeStamp());
            }
        }
        return metadataByPackage;
    }

    private JSONObject emptyForegroundMetadata(long sinceEpochMillis, long now) throws Exception {
        JSONObject metadata = new JSONObject();
        metadata.put("windowMinutes", Math.max(1L, (now - sinceEpochMillis) / 60000L));
        metadata.put("foregroundCount", 0);
        metadata.put("foregroundTimestamps", new JSONArray());
        metadata.put("eventSource", "UsageStatsManager.queryEvents");
        return metadata;
    }

    private void appendLocationLog(JSONArray logs) {
        if (!has(Manifest.permission.ACCESS_COARSE_LOCATION) && !has(Manifest.permission.ACCESS_FINE_LOCATION)) return;
        try {
            LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            Location best = null;
            for (String provider : manager.getProviders(true)) {
                Location location = manager.getLastKnownLocation(provider);
                if (location == null) continue;
                if (best == null || location.getTime() > best.getTime()) {
                    best = location;
                }
            }
            if (best != null && logs.length() < MAX_LOGS) {
                logs.put(createLog(
                        "location",
                        "Last known device location",
                        String.format(Locale.US, "%.5f, %.5f via %s", best.getLatitude(), best.getLongitude(), best.getProvider()),
                        best.getTime()
                ).put("id", "android-location-" + best.getTime()));
            }
        } catch (Exception ignored) {
        }
    }

    private JSONObject task(String title, int duration, String targetTime, String avoidance, String nextAction, String[] steps) throws Exception {
        JSONArray stepArray = new JSONArray();
        for (String step : steps) {
            JSONObject item = new JSONObject();
            item.put("title", step);
            item.put("durationMinutes", Math.max(5, duration / Math.max(1, steps.length)));
            stepArray.put(item);
        }
        JSONObject task = new JSONObject();
        task.put("title", title);
        task.put("estimatedDurationMinutes", duration);
        if (targetTime != null && !targetTime.isEmpty()) {
            task.put("targetTime", targetTime);
        }
        task.put("avoidanceTarget", avoidance);
        task.put("nextPhysicalAction", nextAction);
        task.put("steps", stepArray);
        return task;
    }

    private String combineLogText(String logsJson) {
        StringBuilder out = new StringBuilder();
        try {
            JSONArray logs = new JSONArray(logsJson);
            for (int i = 0; i < logs.length(); i++) {
                JSONObject item = logs.optJSONObject(i);
                if (item == null) continue;
                out.append(' ')
                        .append(item.optString("title"))
                        .append(' ')
                        .append(item.optString("content"));
            }
        } catch (Exception ignored) {
            out.append(logsJson == null ? "" : logsJson);
        }
        return out.toString();
    }

    private JSONArray rankLogs(JSONArray logs) {
        List<JSONObject> items = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < logs.length(); i++) {
            JSONObject item = logs.optJSONObject(i);
            if (item == null) continue;
            try {
                String source = item.optString("source", "user_note");
                String title = item.optString("title", "Phone signal");
                String content = item.optString("content", "");
                String packageName = item.optString("packageName", "");
                long capturedAt = item.optLong("capturedAtEpochMillis", 0L);
                if (capturedAt <= 0L) {
                    capturedAt = now - i;
                    item.put("capturedAtEpochMillis", capturedAt);
                }
                int score = relevanceScore(source, title, content, packageName, capturedAt);
                item.put("relevanceScore", score);
                item.put("relevanceReason", relevanceReason(source, title, content, packageName, score, capturedAt));
                items.add(item);
            } catch (Exception ignored) {
            }
        }

        Collections.sort(items, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject left, JSONObject right) {
                int scoreDiff = right.optInt("relevanceScore", 0) - left.optInt("relevanceScore", 0);
                if (scoreDiff != 0) return scoreDiff;
                long rightTime = right.optLong("capturedAtEpochMillis", 0L);
                long leftTime = left.optLong("capturedAtEpochMillis", 0L);
                return Long.compare(rightTime, leftTime);
            }
        });

        JSONArray ranked = new JSONArray();
        for (int i = 0; i < items.size() && i < MAX_LOGS; i++) {
            ranked.put(items.get(i));
        }
        return ranked;
    }

    // Mirrors src/lifeopsRules.ts. Update the TS fixtures and this Java mirror together.
    private JSONObject taskFromSignal(JSONObject log) throws Exception {
        String source = log.optString("source", "user_note");
        String title = log.optString("title", "Phone signal");
        String content = log.optString("content", "");
        String text = (title + " " + content).toLowerCase(Locale.US);

        if ("calendar".equals(source)) {
            return task(
                    inferTaskTitle(log),
                    30,
                    inferTargetTime(log),
                    "Rereading the event instead of preparing the first real item",
                    firstActionForSignal(log),
                    new String[]{"Open the calendar event", "Find the location, time, and required item", "Put the first required item where you can see it"}
            );
        }

        if (isMissedCallSignal(source, title, content)) {
            return task(
                    inferTaskTitle(log),
                    10,
                    inferTargetTime(log),
                    "Checking unrelated notifications before returning the call",
                    firstActionForSignal(log),
                    new String[]{"Open Phone", "Call or message " + contactFromTitle(title), "Write down any follow-up from the call"}
            );
        }

        if (("sms".equals(source) || "notification".equals(source) || "screen_text".equals(source) || "user_note".equals(source)) && hasActionLanguage(text)) {
            return task(
                    inferTaskTitle(log),
                    15,
                    inferTargetTime(log),
                    "Opening unrelated apps before this is handled",
                    firstActionForSignal(log),
                    new String[]{"Open the source app or thread", "Act on: " + cleanFragment(content.isEmpty() ? title : content, 80), "Close the loop and return here"}
            );
        }

        return null;
    }

    // Mirrors src/lifeopsRules.ts scoreSignal. Keep Java parity with the TS fixture tests.
    private int relevanceScore(String source, String title, String content) {
        return relevanceScore(source, title, content, "", System.currentTimeMillis());
    }

    private int relevanceScore(String source, String title, String content, long capturedAt) {
        return relevanceScore(source, title, content, "", capturedAt);
    }

    private int relevanceScore(String source, String title, String content, String packageName, long capturedAt) {
        String text = (safe(title, "") + " " + safe(content, "")).toLowerCase(Locale.US);
        if (isPlaceholderSignal(text)) return 0;
        if (isClinicalContent(text)) return 0;
        if (!"calendar".equals(source) && isNoiseSignal(text)) return 0;
        if ("location".equals(source)) return 0;
        if (isExpiredSignal(source, title, content, capturedAt)) return 0;
        if (isMissedCallSignal(source, title, content)) return 4;
        if (isCallLogSignal(source, title, content)) return 1;
        if ("app_usage".equals(source) && isIgnoredUsagePackage("", title + " " + content)) return 0;
        if ("screen_text".equals(source) && isIgnoredScreenTextPackage(packageName, title)) return 0;
        if ("app_usage".equals(source)) return isDistractionSignal(text) ? 2 : 0;

        int score = 0;
        if ("calendar".equals(source)) score += 4;
        if (hasActionLanguage(text)) score += 3;
        if ((hasActionLanguage(text) || "calendar".equals(source)) && hasTimeLanguage(text)) {
            score += 2;
        }
        if (("sms".equals(source) || "notification".equals(source)) && hasActionLanguage(text)) score += 1;
        if (containsAny(text, new String[]{" ad ", " sale ", " promo", "newsletter", "weather", "battery", "download", "updated", "playing", "screen time summary"})) {
            score -= 2;
        }
        return Math.max(0, score);
    }

    private String relevanceReason(String source, String title, String content, int score) {
        return relevanceReason(source, title, content, "", score, System.currentTimeMillis());
    }

    private String relevanceReason(String source, String title, String content, int score, long capturedAt) {
        return relevanceReason(source, title, content, "", score, capturedAt);
    }

    private String relevanceReason(String source, String title, String content, String packageName, int score, long capturedAt) {
        String text = title + " " + content;
        if (isExpiredSignal(source, title, content, capturedAt)) return "Expired time/date. Kept as history, but it will not create a task suggestion.";
        if ("screen_text".equals(source) && isIgnoredScreenTextPackage(packageName, title)) return "System or Sentinel screen text. Kept out of task suggestions to avoid self-capture loops.";
        if ("app_usage".equals(source) && isDistractionSignal(text)) return "Drift context only. It can warn while a task is active, but it will not create a fake task.";
        if (isMissedCallSignal(source, title, content)) return "Missed call. This can become a return-call task.";
        if (isCallLogSignal(source, title, content)) return "Call history only. Incoming/outgoing calls are kept as context unless a real follow-up is visible.";
        if ("calendar".equals(source)) return "Calendar event. This can become a preparation task.";
        if (score >= 5) return "High signal: action language, time cue, or calendar context.";
        if (score >= 3) return "Relevant signal: usable for a task suggestion.";
        if ("location".equals(source)) return "Context only: location does not create tasks by itself.";
        return "Context only: no clear action or time cue detected.";
    }

    private boolean hasActionLanguage(String text) {
        return Pattern.compile("\\b(due|deadline|appointment|meeting|meet|leave|arrive|pickup|pick up|bring|send|submit|pay|rent|reservation|confirm|shift|need|needs|please|remember|reply|respond|schedule|reschedule|follow up|check in|return call)\\b|\\b(can you|could you|would you|do you want)\\b|\\bcall\\s+(me|back|them|him|her|us|[a-z][a-z]+)\\b", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    private boolean hasTimeLanguage(String text) {
        return Pattern.compile("\\b\\d{1,2}(:\\d{2})?\\s?(am|pm)\\b|\\bby\\s+\\d{1,2}\\b|\\bat\\s+\\d{1,2}\\b|\\btoday\\b|\\btomorrow\\b|\\byesterday\\b|\\btonight\\b|\\bthis\\s+(morning|afternoon|evening|week)\\b|\\b(mon|tue|wed|thu|fri|sat|sun)(day)?\\b|\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?\\b", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    private boolean isExpiredSignal(String source, String title, String content, long capturedAt) {
        if (isMissedCallSignal(source, title, content)) return false;
        Long targetAt = inferTargetEpochMillis(source, title, content, capturedAt);
        return targetAt != null && System.currentTimeMillis() > targetAt + EXPIRED_SIGNAL_GRACE_MS;
    }

    private Long inferTargetEpochMillis(String source, String title, String content, long capturedAt) {
        if ("calendar".equals(source) && capturedAt > 0L) return capturedAt;

        long baseMillis = capturedAt > 0L ? capturedAt : System.currentTimeMillis();
        Calendar base = Calendar.getInstance();
        base.setTimeInMillis(baseMillis);
        String time = inferTargetTimeFromText(title + " " + content);
        Calendar date = inferExplicitDate(title + " " + content, base);

        if (date != null) {
            applyTime(date, time, time == null);
            return date.getTimeInMillis();
        }
        if (time != null) {
            Calendar target = startOfDay(base);
            applyTime(target, time, false);
            return target.getTimeInMillis();
        }
        return null;
    }

    private Calendar inferExplicitDate(String text, Calendar base) {
        String lower = safe(text, "").toLowerCase(Locale.US);
        Calendar target = startOfDay(base);
        if (Pattern.compile("\\byesterday\\b").matcher(lower).find()) {
            target.add(Calendar.DATE, -1);
            return target;
        }
        if (Pattern.compile("\\btoday\\b|\\btonight\\b").matcher(lower).find()) return target;
        if (Pattern.compile("\\btomorrow\\b").matcher(lower).find()) {
            target.add(Calendar.DATE, 1);
            return target;
        }

        Matcher numeric = Pattern.compile("\\b(1[0-2]|0?[1-9])[/-]([0-3]?\\d)(?:[/-](\\d{2,4}))?\\b").matcher(lower);
        if (numeric.find()) {
            int year = numeric.group(3) == null ? base.get(Calendar.YEAR) : Integer.parseInt(numeric.group(3));
            if (year < 100) year += 2000;
            target.set(Calendar.YEAR, year);
            target.set(Calendar.MONTH, Integer.parseInt(numeric.group(1)) - 1);
            target.set(Calendar.DAY_OF_MONTH, Integer.parseInt(numeric.group(2)));
            return target;
        }

        Matcher named = Pattern.compile("\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b").matcher(lower);
        if (named.find()) {
            target.set(Calendar.YEAR, named.group(3) == null ? base.get(Calendar.YEAR) : Integer.parseInt(named.group(3)));
            target.set(Calendar.MONTH, monthIndex(named.group(1)));
            target.set(Calendar.DAY_OF_MONTH, Integer.parseInt(named.group(2)));
            return target;
        }

        Matcher weekday = Pattern.compile("\\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\\b").matcher(lower);
        if (weekday.find()) {
            int targetDay = weekdayIndex(weekday.group(1));
            int delta = (targetDay - target.get(Calendar.DAY_OF_WEEK) + 7) % 7;
            target.add(Calendar.DATE, delta);
            return target;
        }

        return null;
    }

    private String inferTargetTimeFromText(String text) {
        Matcher explicit = Pattern.compile("\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b", Pattern.CASE_INSENSITIVE).matcher(text == null ? "" : text);
        if (explicit.find()) {
            int hour = Integer.parseInt(explicit.group(1));
            int minute = explicit.group(2) == null ? 0 : Integer.parseInt(explicit.group(2));
            String suffix = explicit.group(3).toLowerCase(Locale.US);
            if ("pm".equals(suffix) && hour < 12) hour += 12;
            if ("am".equals(suffix) && hour == 12) hour = 0;
            return String.format(Locale.US, "%02d:%02d", hour, minute);
        }

        Matcher contextual = Pattern.compile("\\b(?:at|by|before|around|arrive|leave|meeting|meet|appointment|reservation|shift)\\s+(\\d{1,2})(?::(\\d{2}))?\\b", Pattern.CASE_INSENSITIVE).matcher(text == null ? "" : text);
        if (contextual.find()) {
            int hour = Integer.parseInt(contextual.group(1));
            int minute = contextual.group(2) == null ? 0 : Integer.parseInt(contextual.group(2));
            if (hour >= 1 && hour <= 7) hour += 12;
            return String.format(Locale.US, "%02d:%02d", hour, minute);
        }
        return null;
    }

    private Calendar startOfDay(Calendar source) {
        Calendar target = (Calendar) source.clone();
        target.set(Calendar.HOUR_OF_DAY, 0);
        target.set(Calendar.MINUTE, 0);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);
        return target;
    }

    private void applyTime(Calendar target, String time, boolean endOfDay) {
        if (time == null) {
            if (endOfDay) {
                target.set(Calendar.HOUR_OF_DAY, 23);
                target.set(Calendar.MINUTE, 59);
                target.set(Calendar.SECOND, 59);
                target.set(Calendar.MILLISECOND, 999);
            }
            return;
        }
        String[] parts = time.split(":");
        target.set(Calendar.HOUR_OF_DAY, Integer.parseInt(parts[0]));
        target.set(Calendar.MINUTE, Integer.parseInt(parts[1]));
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);
    }

    private int monthIndex(String month) {
        String key = month.toLowerCase(Locale.US);
        if (key.startsWith("jan")) return Calendar.JANUARY;
        if (key.startsWith("feb")) return Calendar.FEBRUARY;
        if (key.startsWith("mar")) return Calendar.MARCH;
        if (key.startsWith("apr")) return Calendar.APRIL;
        if (key.startsWith("may")) return Calendar.MAY;
        if (key.startsWith("jun")) return Calendar.JUNE;
        if (key.startsWith("jul")) return Calendar.JULY;
        if (key.startsWith("aug")) return Calendar.AUGUST;
        if (key.startsWith("sep")) return Calendar.SEPTEMBER;
        if (key.startsWith("oct")) return Calendar.OCTOBER;
        if (key.startsWith("nov")) return Calendar.NOVEMBER;
        return Calendar.DECEMBER;
    }

    private int weekdayIndex(String day) {
        String key = day.toLowerCase(Locale.US);
        if (key.startsWith("sun")) return Calendar.SUNDAY;
        if (key.startsWith("mon")) return Calendar.MONDAY;
        if (key.startsWith("tue")) return Calendar.TUESDAY;
        if (key.startsWith("wed")) return Calendar.WEDNESDAY;
        if (key.startsWith("thu")) return Calendar.THURSDAY;
        if (key.startsWith("fri")) return Calendar.FRIDAY;
        return Calendar.SATURDAY;
    }

    private boolean isNoiseSignal(String text) {
        return Pattern.compile("\\b(charging|battery|weather|forecast|temperature|humidity|rain|snow|wind|degrees?|cooler than|warmer than|sunny|cloudy|download complete|updated in background)\\b|\\u00b0|\\u00c2\\u00b0", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    private boolean isPlaceholderSignal(String text) {
        return Pattern.compile("cloud[\\s_-]*file|open\\s+(the\\s+)?source\\s+signal\\s+only|^follow up:\\s*.*reminder", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    // Mirrors src/lifeopsRules.ts isClinicalContent. PHI/work guard: Credible EHR +
    // Monarch + clinical-program markers. Deliberately narrow so ordinary signals still
    // flow. This only zeroes the task-suggestion SCORE; it does NOT affect capture/export.
    private boolean isClinicalContent(String text) {
        return Pattern.compile("\\bcrediblebh\\b|\\bcbh3\\b|\\bcredible\\b|\\bmonarch\\b|\\bnctracks\\b|\\bnc-?topps\\b|\\bmedicaid\\b|\\biihs?\\b|\\bsign and submit\\b|\\bsvc note\\b|\\bservice note\\b", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    private boolean isDistractionSignal(String text) {
        return Pattern.compile("\\b(instagram|reddit|tiktok|youtube|facebook|netflix|reels|shorts|scroll|scrolling)\\b", Pattern.CASE_INSENSITIVE)
                .matcher(text == null ? "" : text)
                .find();
    }

    private boolean isIgnoredUsagePackage(String packageName, String label) {
        String text = (safe(packageName, "") + " " + safe(label, "")).toLowerCase(Locale.US);
        return Pattern.compile("\\b(launcher|systemui|settings|permissioncontroller|webview|sentinellifeops|keyboard|inputmethod)\\b|^android\\.|com\\.android\\.", Pattern.CASE_INSENSITIVE)
                .matcher(text)
                .find();
    }

    private boolean isIgnoredScreenTextPackage(String packageName, String title) {
        String text = (safe(packageName, "") + " " + safe(title, "")).toLowerCase(Locale.US);
        return Pattern.compile("\\b(launcher|systemui|settings|permissioncontroller|sentinellifeops|keyboard|inputmethod)\\b|^android\\.|com\\.android\\.|com\\.jackson\\.sentinellifeops", Pattern.CASE_INSENSITIVE)
                .matcher(text)
                .find();
    }

    private boolean isCallLogSignal(String source, String title, String content) {
        return "notification".equals(source)
                && Pattern.compile("\\b(incoming|outgoing|missed)\\s+call:", Pattern.CASE_INSENSITIVE).matcher(title == null ? "" : title).find()
                && Pattern.compile("\\bduration:\\s*\\d+\\s*seconds\\b", Pattern.CASE_INSENSITIVE).matcher(content == null ? "" : content).find();
    }

    private boolean isMissedCallSignal(String source, String title, String content) {
        return isCallLogSignal(source, title, content)
                && Pattern.compile("^missed call:", Pattern.CASE_INSENSITIVE).matcher(title == null ? "" : title).find();
    }

    private String contactFromTitle(String title) {
        return cleanFragment(safe(title, "")
                .replaceFirst("(?i)^(sms from|missed call:|incoming call:|outgoing call:|notification from)\\s*", "")
                .replaceFirst("(?i)^active notification from\\s*", ""), 40);
    }

    private String inferTaskTitle(JSONObject log) {
        String source = log.optString("source", "user_note");
        String title = log.optString("title", "");
        String content = log.optString("content", "");
        String text = title + " " + content;
        String subject = cleanFragment(content.isEmpty() ? title : content, 78);
        String person = contactFromTitle(title);

        if ("calendar".equals(source)) return "Prepare for " + cleanFragment(title, 64);
        if (isMissedCallSignal(source, title, content)) return "Return missed call from " + person;
        if (Pattern.compile("\\b(reply|respond|text back|message back)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Reply to " + person;
        if (Pattern.compile("\\b(pay|rent|invoice|bill)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Pay or confirm: " + subject;
        if (Pattern.compile("\\b(send|submit|email)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Send or submit: " + subject;
        if (Pattern.compile("\\b(pickup|pick up|bring)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Prepare item: " + subject;
        if (Pattern.compile("\\b(call\\s+(me|back|them|him|her|us|[a-z])|phone)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Call back: " + person;
        if (Pattern.compile("\\b(appointment|meeting|meet|reservation|shift)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Prepare for: " + subject;
        return "Handle: " + subject;
    }

    private String firstActionForSignal(JSONObject log) {
        String source = log.optString("source", "user_note");
        String title = log.optString("title", "");
        String content = log.optString("content", "");
        String text = title + " " + content;
        String person = contactFromTitle(title);

        if ("calendar".equals(source)) return "Open the calendar event and put the first required item in one visible place.";
        if (isMissedCallSignal(source, title, content)) return "Open Phone and return the missed call from " + person + ".";
        if (Pattern.compile("\\b(reply|respond|text back|message back)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Open the message thread with " + person + " and write the shortest useful reply.";
        if (Pattern.compile("\\b(pay|rent|invoice|bill)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Open the payment or account page and confirm the amount due.";
        if (Pattern.compile("\\b(send|submit|email)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Open the needed app and attach or send the requested item.";
        if (Pattern.compile("\\b(pickup|pick up|bring)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) return "Put the named item in one visible place now.";
        return "Open the source app and do only the requested action.";
    }

    private String inferTargetTime(JSONObject log) {
        String source = log.optString("source", "user_note");
        String title = log.optString("title", "");
        String content = log.optString("content", "");
        String text = title + " " + content;

        Matcher explicit = Pattern.compile("\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b", Pattern.CASE_INSENSITIVE).matcher(text);
        if (explicit.find()) {
            int hour = Integer.parseInt(explicit.group(1));
            int minute = explicit.group(2) == null ? 0 : Integer.parseInt(explicit.group(2));
            String suffix = explicit.group(3).toLowerCase(Locale.US);
            if ("pm".equals(suffix) && hour < 12) hour += 12;
            if ("am".equals(suffix) && hour == 12) hour = 0;
            return String.format(Locale.US, "%02d:%02d", hour, minute);
        }

        Matcher contextual = Pattern.compile("\\b(?:at|by|before|around|arrive|leave|meeting|meet|appointment|reservation|shift)\\s+(\\d{1,2})(?::(\\d{2}))?\\b", Pattern.CASE_INSENSITIVE).matcher(text);
        if (contextual.find()) {
            int hour = Integer.parseInt(contextual.group(1));
            int minute = contextual.group(2) == null ? 0 : Integer.parseInt(contextual.group(2));
            if (hour >= 1 && hour <= 7) hour += 12;
            return String.format(Locale.US, "%02d:%02d", hour, minute);
        }

        if ("calendar".equals(source)) {
            long capturedAt = log.optLong("capturedAtEpochMillis", 0L);
            if (capturedAt > 0L) {
                return TARGET_TIME_FORMAT.format(new Date(capturedAt));
            }
        }

        return null;
    }

    private boolean containsAny(String text, String[] needles) {
        String haystack = text == null ? "" : text.toLowerCase(Locale.US);
        for (String needle : needles) {
            if (haystack.contains(needle)) return true;
        }
        return false;
    }

    private String cleanFragment(String value, int max) {
        String cleaned = safe(value, "phone signal")
                .replaceFirst("(?i)^Calendar:\\s*", "")
                .replaceFirst("(?i)^App usage:\\s*", "")
                .replaceFirst("(?i)^Foreground screen text:\\s*", "")
                .replaceFirst("(?i)^Active notification from\\s*", "")
                .replaceFirst("(?i)^Notification from\\s*", "")
                .replaceAll("\\s+", " ")
                .trim();
        if (cleaned.isEmpty()) cleaned = "phone signal";
        return cleaned.length() > max ? cleaned.substring(0, Math.max(1, max - 1)).trim() + "..." : cleaned;
    }

    private JSONObject createLog(String source, String title, String content, long timestamp) throws Exception {
        long actualTime = timestamp > 0 ? timestamp : System.currentTimeMillis();
        String safeTitle = safe(title, "Phone signal");
        String safeContent = safe(content, "");
        JSONObject log = new JSONObject();
        log.put("id", "android-log-" + actualTime + "-" + Math.abs((safeTitle + safeContent).hashCode()) + "-" + LOG_ID_SEQUENCE.incrementAndGet());
        log.put("timestamp", TIME_FORMAT.format(new Date(actualTime)));
        log.put("capturedAtEpochMillis", actualTime);
        log.put("source", source);
        log.put("title", safeTitle);
        log.put("content", safeContent);
        int score = relevanceScore(source, safeTitle, safeContent, actualTime);
        log.put("relevanceScore", score);
        log.put("relevanceReason", relevanceReason(source, safeTitle, safeContent, score, actualTime));
        return log;
    }

    private JSONArray getCustomLogs() {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CUSTOM_LOGS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void appendArray(JSONArray target, JSONArray source) {
        for (int i = 0; i < source.length() && target.length() < MAX_LOGS; i++) {
            target.put(source.opt(i));
        }
    }

    private boolean has(String permission) {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasUsageAccess() {
        try {
            AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
            int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isEnabledSetting(String settingName) {
        String enabled = Settings.Secure.getString(context.getContentResolver(), settingName);
        return enabled != null && enabled.toLowerCase(Locale.US).contains(context.getPackageName().toLowerCase(Locale.US));
    }

    private void openSettings(String action) {
        Intent intent = new Intent(action);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private String labelForNumber(String number) {
        if (number == null || number.trim().isEmpty()) {
            return "Unknown";
        }
        if (!has(Manifest.permission.READ_CONTACTS)) {
            return number;
        }

        ContentResolver resolver = context.getContentResolver();
        Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return number;
    }

    private String labelForPackage(String packageName) {
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            return pm.getApplicationLabel(info).toString() + " (" + packageName + ")";
        } catch (Exception ignored) {
            return packageName;
        }
    }

    private String normalizeBaseUrl(String baseUrl) {
        String clean = baseUrl == null ? "" : baseUrl.trim();
        while (clean.endsWith("/")) {
            clean = clean.substring(0, clean.length() - 1);
        }
        return clean;
    }

    // Defense-in-depth: validate the resolved export destination against the same
    // host-allowlist policy MainActivity uses for WebView network requests
    // (LIFEOPS_API_HOST over https + isLocalNetworkHost). Local hosts are permitted
    // over http OR https because the export script (scripts/export-android-telemetry.ps1)
    // rewrites the target to https://127.0.0.1:<port> when adb reverse is active.
    // If we cannot parse/classify the target, ERR ON THE SIDE OF ALLOWING so a real
    // export is never silently dropped; the caller logs a warning instead.
    private boolean isAllowedExportTarget(String endpoint) {
        try {
            URL url = new URL(endpoint);
            String scheme = url.getProtocol() == null ? "" : url.getProtocol().toLowerCase(Locale.US);
            String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.US);
            if ("https".equals(scheme) && LIFEOPS_API_HOST.equals(host)) {
                return true;
            }
            if (("http".equals(scheme) || "https".equals(scheme)) && isLocalNetworkHost(host)) {
                return true;
            }
            return false;
        } catch (Exception e) {
            // Unable to classify the target: do not risk breaking a legitimate export.
            return true;
        }
    }

    // Mirrors MainActivity.isLocalNetworkHost exactly: loopback + RFC1918 private ranges
    // (10.0.0.0/8, 192.168.0.0/16, 172.16.0.0-172.31.255.255).
    private boolean isLocalNetworkHost(String host) {
        return "localhost".equals(host)
                || "127.0.0.1".equals(host)
                || host.startsWith("10.")
                || host.startsWith("192.168.")
                || host.matches("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*");
    }

    private String readResponseBody(HttpURLConnection connection, int status) {
        InputStream stream = null;
        try {
            stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            if (stream == null) {
                return "";
            }
            StringBuilder out = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && out.length() < 4000) {
                    out.append(line);
                }
            }
            return out.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private String safe(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return fallback;
        return trimmed.length() > 1800 ? trimmed.substring(0, 1800) : trimmed;
    }

    private String errorJson(Exception e) {
        try {
            return new JSONObject()
                    .put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage())
                    .toString();
        } catch (Exception ignored) {
            return "{\"error\":\"unknown\"}";
        }
    }
}
