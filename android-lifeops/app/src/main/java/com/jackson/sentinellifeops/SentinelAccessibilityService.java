package com.jackson.sentinellifeops;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class SentinelAccessibilityService extends AccessibilityService {
    private static final int MAX_RECENT = 12;
    private static final long POLL_INTERVAL_MS = 5000L;
    private static final List<JSONObject> RECENT = new ArrayList<>();
    private static final SimpleDateFormat TIME_FORMAT = new SimpleDateFormat("hh:mm a", Locale.US);
    private static SentinelAccessibilityService currentService;
    private static JSONObject latestLog;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String lastSnapshotKey = "";
    private long lastSnapshotAt = 0L;
    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            captureForegroundSnapshot("poll");
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        currentService = this;
        handler.removeCallbacks(pollRunnable);
        handler.post(pollRunnable);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) {
            return;
        }
        captureForegroundSnapshot(event.getPackageName().toString());
    }

    private void captureForegroundSnapshot(String packageHint) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        CharSequence rootPackage = root != null ? root.getPackageName() : null;
        StringBuilder text = new StringBuilder();
        collectText(root, text, 1600);
        if (root != null) {
            root.recycle();
        }

        String snapshot = text.toString().trim();
        if (snapshot.length() < 8) {
            return;
        }

        String packageName = packageHint == null || "poll".equals(packageHint) || "refresh".equals(packageHint)
                ? ""
                : packageHint;
        if (packageName.isEmpty() && rootPackage != null) {
            packageName = rootPackage.toString();
        }
        if (isIgnoredScreenPackage(packageName)) {
            return;
        }
        String snapshotKey = packageName + ":" + snapshot;
        long now = System.currentTimeMillis();
        if (snapshotKey.equals(lastSnapshotKey) && now - lastSnapshotAt < POLL_INTERVAL_MS) {
            return;
        }
        lastSnapshotKey = snapshotKey;
        lastSnapshotAt = now;

        JSONObject log = new JSONObject();
        try {
            log.put("id", "android-accessibility-" + now);
            log.put("timestamp", TIME_FORMAT.format(new Date(now)));
            log.put("source", "screen_text");
            log.put("title", packageName.isEmpty() ? "Foreground screen text" : "Foreground screen text: " + packageName);
            log.put("content", snapshot);
            log.put("capturedAtEpochMillis", now);
            if (!packageName.isEmpty()) {
                log.put("packageName", packageName);
            }
        } catch (Exception ignored) {
            return;
        }

        synchronized (RECENT) {
            latestLog = log;
            RECENT.add(0, log);
            while (RECENT.size() > MAX_RECENT) {
                RECENT.remove(RECENT.size() - 1);
            }
        }
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pollRunnable);
        if (currentService == this) {
            currentService = null;
        }
        super.onDestroy();
    }

    static JSONArray activeWindowLog() {
        SentinelAccessibilityService service = currentService;
        if (service != null) {
            service.captureForegroundSnapshot("refresh");
        }
        JSONArray array = new JSONArray();
        synchronized (RECENT) {
            if (latestLog != null) {
                array.put(latestLog);
            }
        }
        return array;
    }

    static JSONArray recentLogs() {
        JSONArray array = new JSONArray();
        synchronized (RECENT) {
            for (JSONObject item : RECENT) {
                array.put(item);
            }
        }
        return array;
    }

    private static void collectText(AccessibilityNodeInfo node, StringBuilder out, int maxChars) {
        if (node == null || out.length() >= maxChars) {
            return;
        }
        CharSequence text = node.getText();
        CharSequence description = node.getContentDescription();
        append(out, text, maxChars);
        append(out, description, maxChars);
        for (int i = 0; i < node.getChildCount() && out.length() < maxChars; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            collectText(child, out, maxChars);
            if (child != null) {
                child.recycle();
            }
        }
    }

    private static void append(StringBuilder out, CharSequence value, int maxChars) {
        if (value == null || out.length() >= maxChars) {
            return;
        }
        String clean = value.toString().trim().replaceAll("\\s+", " ");
        if (clean.isEmpty()) {
            return;
        }
        if (out.length() > 0) {
            out.append(" | ");
        }
        int room = Math.max(0, maxChars - out.length());
        out.append(clean, 0, Math.min(clean.length(), room));
    }

    private boolean isIgnoredScreenPackage(String packageName) {
        String clean = packageName == null ? "" : packageName.toLowerCase(Locale.US);
        return clean.equals(getPackageName())
                || clean.contains("systemui")
                || clean.contains("launcher")
                || clean.contains("permissioncontroller")
                || clean.contains("inputmethod")
                || clean.contains("keyboard")
                || MicrosoftTelemetryFilter.isMicrosoftPackageName(clean);
    }
}
