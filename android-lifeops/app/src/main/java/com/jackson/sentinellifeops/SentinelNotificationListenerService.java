package com.jackson.sentinellifeops;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;

public class SentinelNotificationListenerService extends NotificationListenerService {
    private static final int MAX_RECENT = 30;
    private static final List<JSONObject> RECENT = new ArrayList<>();
    private static final SimpleDateFormat TIME_FORMAT = new SimpleDateFormat("hh:mm a", Locale.US);
    // Monotonic counter so two notifications with the same getKey()/post-time hashCode
    // still get distinct ids and are not silently de-duplicated downstream.
    private static final AtomicLong ID_SEQUENCE = new AtomicLong(0L);
    private static SentinelNotificationListenerService instance;

    // Stable-enough, non-empty, collision-resistant key for a notification log id.
    // Null-guards getKey() (AND-9) so a null key cannot throw, and appends a monotonic
    // suffix (CONTRACT-5) so equal hashCodes do not collide.
    private static String uniqueKeySuffix(StatusBarNotification sbn) {
        String key = sbn == null ? null : sbn.getKey();
        int keyHash = Math.abs(key == null ? sbn == null ? 0 : sbn.getPackageName().hashCode() : key.hashCode());
        return keyHash + "-" + ID_SEQUENCE.incrementAndGet();
    }

    @Override
    public void onListenerConnected() {
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) {
            return;
        }
        if ("com.jackson.sentinellifeops".equals(sbn.getPackageName())) {
            return;
        }
        if (MicrosoftTelemetryFilter.isMicrosoftPackageName(sbn.getPackageName())) {
            return;
        }

        Notification notification = sbn.getNotification();
        CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence subText = notification.extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

        String content = joinNonEmpty(
                text == null ? "" : text.toString(),
                subText == null ? "" : subText.toString()
        );
        if (content.isEmpty() && title == null) {
            return;
        }

        JSONObject log = new JSONObject();
        try {
            log.put("id", "android-notification-" + sbn.getPostTime() + "-" + uniqueKeySuffix(sbn));
            log.put("timestamp", TIME_FORMAT.format(new Date(sbn.getPostTime())));
            log.put("capturedAtEpochMillis", sbn.getPostTime());
            log.put("source", "notification");
            log.put("title", title == null ? "Notification from " + sbn.getPackageName() : title.toString());
            log.put("content", sbn.getPackageName() + ": " + content);
            log.put("packageName", sbn.getPackageName());
        } catch (Exception ignored) {
            return;
        }

        synchronized (RECENT) {
            RECENT.add(0, log);
            while (RECENT.size() > MAX_RECENT) {
                RECENT.remove(RECENT.size() - 1);
            }
        }
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

    static JSONArray activeNotificationLogs() {
        JSONArray array = new JSONArray();
        SentinelNotificationListenerService service = instance;
        if (service == null) {
            return array;
        }
        try {
            StatusBarNotification[] active = service.getActiveNotifications();
            if (active == null) {
                return array;
            }
            int count = 0;
            for (StatusBarNotification sbn : active) {
                // AND-10: isolate each notification so one bad row is skipped instead of
                // truncating the whole sweep (which would drop later, valid notifications).
                try {
                    if (sbn == null || sbn.getNotification() == null || "com.jackson.sentinellifeops".equals(sbn.getPackageName())) {
                        continue;
                    }
                    if (MicrosoftTelemetryFilter.isMicrosoftPackageName(sbn.getPackageName())) {
                        continue;
                    }
                    Notification notification = sbn.getNotification();
                    CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
                    CharSequence text = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
                    CharSequence subText = notification.extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
                    String content = joinNonEmpty(text == null ? "" : text.toString(), subText == null ? "" : subText.toString());
                    if (content.isEmpty() && title == null) {
                        continue;
                    }
                    JSONObject log = new JSONObject();
                    log.put("id", "android-active-notification-" + sbn.getPostTime() + "-" + uniqueKeySuffix(sbn));
                    log.put("timestamp", TIME_FORMAT.format(new Date(sbn.getPostTime())));
                    log.put("capturedAtEpochMillis", sbn.getPostTime());
                    log.put("source", "notification");
                    log.put("title", title == null ? "Active notification from " + sbn.getPackageName() : title.toString());
                    log.put("content", sbn.getPackageName() + ": " + content);
                    log.put("packageName", sbn.getPackageName());
                    array.put(log);
                    count++;
                    if (count >= MAX_RECENT) {
                        break;
                    }
                } catch (Exception perNotification) {
                    // Skip this single notification and keep sweeping.
                }
            }
        } catch (Exception ignored) {
        }
        return array;
    }

    private static String joinNonEmpty(String first, String second) {
        String a = first == null ? "" : first.trim();
        String b = second == null ? "" : second.trim();
        if (a.isEmpty()) return b;
        if (b.isEmpty()) return a;
        return a + " / " + b;
    }
}
