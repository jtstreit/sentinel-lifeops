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

public class SentinelNotificationListenerService extends NotificationListenerService {
    private static final int MAX_RECENT = 30;
    private static final List<JSONObject> RECENT = new ArrayList<>();
    private static final SimpleDateFormat TIME_FORMAT = new SimpleDateFormat("hh:mm a", Locale.US);
    private static SentinelNotificationListenerService instance;

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
            log.put("id", "android-notification-" + sbn.getPostTime() + "-" + Math.abs(sbn.getKey().hashCode()));
            log.put("timestamp", TIME_FORMAT.format(new Date(sbn.getPostTime())));
            log.put("source", "notification");
            log.put("title", title == null ? "Notification from " + sbn.getPackageName() : title.toString());
            log.put("content", sbn.getPackageName() + ": " + content);
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
                if (sbn == null || sbn.getNotification() == null || "com.jackson.sentinellifeops".equals(sbn.getPackageName())) {
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
                log.put("id", "android-active-notification-" + sbn.getPostTime() + "-" + Math.abs(sbn.getKey().hashCode()));
                log.put("timestamp", TIME_FORMAT.format(new Date(sbn.getPostTime())));
                log.put("source", "notification");
                log.put("title", title == null ? "Active notification from " + sbn.getPackageName() : title.toString());
                log.put("content", sbn.getPackageName() + ": " + content);
                array.put(log);
                count++;
                if (count >= MAX_RECENT) {
                    break;
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
