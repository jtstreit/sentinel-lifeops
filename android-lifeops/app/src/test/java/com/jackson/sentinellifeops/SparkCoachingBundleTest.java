package com.jackson.sentinellifeops;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class SparkCoachingBundleTest {
    private static final long NOW = 1_752_600_000_000L;

    @Test
    public void keepsOnlyTheRollingPrevious24Hours() throws Exception {
        JSONArray logs = new JSONArray()
                .put(event("recent", "sms", "com.google.android.apps.messaging", NOW - 60_000L, "Please call me back"))
                .put(event("old", "sms", "com.google.android.apps.messaging", NOW - SparkCoachingBundle.LOOKBACK_MS - 1L, "Old message"))
                .put(event("future", "calendar", "com.google.android.calendar", NOW + 1L, "Future event"));

        JSONObject bundle = SparkCoachingBundle.build(new JSONObject().put("logs", logs), NOW);
        assertEquals(1, bundle.getInt("eventCount"));
        assertEquals("recent", bundle.getJSONArray("events").getJSONObject(0).getString("id"));
    }

    @Test
    public void excludesMonarchProtectedSurfacesAndCredentialEventsButKeepsPersonalMicrosoft() throws Exception {
        JSONArray logs = new JSONArray()
                .put(event("credible", "screen_text", "com.android.chrome", NOW - 10L, "https://login.cbh3.crediblebh.com/"))
                .put(event("microsoft", "screen_text", "com.brave.browser", NOW - 20L, "https://outlook.office.com/mail"))
                .put(event("monarch", "notification", "com.microsoft.teams", NOW - 25L, "Message for jackson@monarchnc.org"))
                .put(event("otp", "notification", "com.google.android.apps.authenticator2", NOW - 30L, "Verification code 123456"))
                .put(event("safe", "app_usage", "com.example.focus", NOW - 40L, "25 minutes foreground"));

        JSONObject bundle = SparkCoachingBundle.build(new JSONObject().put("logs", logs), NOW);
        assertEquals(2, bundle.getInt("eventCount"));
        assertEquals("microsoft", bundle.getJSONArray("events").getJSONObject(0).getString("id"));
        assertEquals("safe", bundle.getJSONArray("events").getJSONObject(1).getString("id"));
        assertEquals(1, bundle.getJSONObject("privacy").getInt("credentialEventsRemoved"));
    }

    @Test
    public void redactsNamedAndBearerSecretsBeforeDrive() throws Exception {
        JSONObject raw = event("secret", "user_note", "com.example.notes", NOW - 10L,
                "api_key=super-secret-value Authorization Bearer abcdefghijklmnop");
        JSONObject bundle = SparkCoachingBundle.build(new JSONObject().put("logs", new JSONArray().put(raw)), NOW);
        String serialized = bundle.toString();
        assertFalse(serialized.contains("super-secret-value"));
        assertFalse(serialized.contains("abcdefghijklmnop"));
        assertTrue(serialized.contains("REDACTED"));
        assertEquals(1, bundle.getJSONObject("privacy").getInt("redactedEvents"));
    }

    @Test
    public void producesSparkReadableMarkdownAndStableNames() throws Exception {
        JSONObject bundle = SparkCoachingBundle.build(new JSONObject().put("logs", new JSONArray()
                .put(event("safe", "sms", "com.google.android.apps.messaging", NOW - 10L, "Please call me back"))), NOW);
        String markdown = SparkCoachingBundle.toMarkdown(bundle);
        assertTrue(markdown.contains("LifeOps Spark Coaching Context"));
        assertTrue(markdown.contains("Please call me back"));
        assertEquals("LifeOps-Coaching-Latest.md", SparkCoachingBundle.latestMarkdownName());
        assertEquals("LifeOps-Telemetry-2025-07-15.json", SparkCoachingBundle.dailyJsonName(NOW));
    }

    private static JSONObject event(String id, String source, String packageName, long capturedAt, String content) throws Exception {
        return new JSONObject()
                .put("id", id)
                .put("source", source)
                .put("packageName", packageName)
                .put("title", "Synthetic " + id)
                .put("content", content)
                .put("capturedAtEpochMillis", capturedAt);
    }
}
