package com.jackson.sentinellifeops;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class MicrosoftTelemetryFilterTest {
    @Test
    public void keepsPersonalMicrosoftAndBlocksMonarchWorkContext() {
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "notification",
                "com.microsoft.office.outlook",
                "Synthetic notification",
                "Synthetic content",
                null));
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.android.chrome",
                "Foreground screen text",
                "https://outlook.office.com/mail/inbox | Inbox | New mail",
                null));
        assertTrue(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.brave.browser",
                "Foreground screen text",
                "https://teams.microsoft.com/ | Microsoft Teams | Chat | jackson@monarchnc.org",
                null));
        assertTrue(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "notification",
                "com.android.chrome",
                "Synthetic web notification",
                "Synthetic content",
                null,
                "p#https://tenant.sharepoint.com/sites/monarch-iih"));
    }

    @Test
    public void blocksCredibleHostsAndStrongPortalMarkers() {
        assertTrue(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.android.chrome",
                "Foreground screen text",
                "https://login.cbh3.crediblebh.com/ | Credible Behavioral Health",
                null));
        assertTrue(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "notification",
                "com.android.chrome",
                "Synthetic portal alert",
                "https://secure.credibleinc.com/",
                null));
    }

    @Test
    public void keepsOrdinaryWordsLinksAndLookalikeHosts() {
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "sms",
                "com.google.android.apps.messaging",
                "Synthetic message",
                "Open https://outlook.office.com/ later.",
                null));
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.android.chrome",
                "Synthetic article",
                "https://outlook.office.com.example.invalid/",
                null));
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.example.notes",
                "Synthetic note",
                "The outlook for the team is credible.",
                null));
        assertFalse(MicrosoftTelemetryFilter.isExcludedTelemetry(
                "screen_text",
                "com.android.chrome",
                "Synthetic page",
                "https://crediblebh.com.example.invalid/",
                null));
    }
}
