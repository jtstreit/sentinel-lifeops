package com.jackson.sentinellifeops;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Locale;
import java.util.regex.Pattern;

final class MicrosoftTelemetryFilter {
    private static final Pattern MICROSOFT_BRANDED_APP = Pattern.compile("\\bmicrosoft\\s+(outlook|teams|edge|onedrive|sharepoint|office|365|copilot|word|excel|power\\s*point|powerpoint|onenote|authenticator)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_PACKAGE_PREFIX = Pattern.compile("^\\s*([a-z][a-z0-9_]*(?:\\.[a-z0-9_]+){1,})\\s*:", Pattern.CASE_INSENSITIVE);
    private static final Pattern TELEMETRY_TITLE_PREFIX = Pattern.compile("^(app usage|foreground screen text|notification from|active notification from)\\s*:?\\s*(.+)$", Pattern.CASE_INSENSITIVE);

    private MicrosoftTelemetryFilter() {
    }

    static boolean isMicrosoftPackageName(String packageName) {
        String clean = clean(packageName);
        return "com.microsoft".equals(clean)
                || clean.startsWith("com.microsoft.")
                || "com.azure.authenticator".equals(clean)
                || clean.startsWith("com.azure.authenticator.");
    }

    static boolean isMicrosoftAppTelemetry(String packageName, String title, String content, JSONObject metadata) {
        if (isMicrosoftPackageName(packageName)) return true;
        if (isMicrosoftPackageName(packagePrefixFromContent(content))) return true;

        String appName = appNameFromTelemetryTitle(title);
        if (!appName.isEmpty() && isMicrosoftAppName(appName)) return true;
        String rawTitle = safe(title, "");
        if (rawTitle.toLowerCase(Locale.US).startsWith("microsoft ") && isMicrosoftAppName(rawTitle)) return true;

        if (metadata != null && metadataContainsMicrosoftApp(metadata)) return true;
        return false;
    }

    static boolean isMicrosoftAppName(String value) {
        String clean = normalizeAppName(value);
        return isMicrosoftPackageName(clean)
                || MICROSOFT_BRANDED_APP.matcher(clean).find()
                || isExactMicrosoftAppName(clean);
    }

    private static boolean metadataContainsMicrosoftApp(JSONObject metadata) {
        Iterator<String> names = metadata.keys();
        while (names.hasNext()) {
            String name = names.next();
            Object value = metadata.opt(name);
            String key = clean(name);
            boolean appContext = key.contains("package")
                    || key.contains("process")
                    || key.contains("app")
                    || key.contains("application")
                    || key.contains("label")
                    || key.contains("source")
                    || key.contains("origin")
                    || key.contains("provider")
                    || key.contains("title");
            if (value instanceof String && appContext) {
                String text = (String) value;
                if (isMicrosoftPackageName(text) || isMicrosoftAppName(text)) return true;
            } else if (value instanceof JSONObject && metadataContainsMicrosoftApp((JSONObject) value)) {
                return true;
            }
        }
        return false;
    }

    private static String appNameFromTelemetryTitle(String title) {
        java.util.regex.Matcher matcher = TELEMETRY_TITLE_PREFIX.matcher(safe(title, ""));
        return matcher.find() ? matcher.group(2).trim() : "";
    }

    private static String packagePrefixFromContent(String content) {
        java.util.regex.Matcher matcher = CONTENT_PACKAGE_PREFIX.matcher(safe(content, ""));
        return matcher.find() ? matcher.group(1) : "";
    }

    private static boolean isExactMicrosoftAppName(String value) {
        String clean = normalizeAppName(value);
        return "microsoft outlook".equals(clean)
                || "outlook".equals(clean)
                || "microsoft teams".equals(clean)
                || "teams".equals(clean)
                || "microsoft edge".equals(clean)
                || "edge".equals(clean)
                || "microsoft onedrive".equals(clean)
                || "onedrive".equals(clean)
                || "one drive".equals(clean)
                || "microsoft sharepoint".equals(clean)
                || "sharepoint".equals(clean)
                || "microsoft office".equals(clean)
                || "office".equals(clean)
                || "microsoft 365".equals(clean)
                || "office 365".equals(clean)
                || "microsoft copilot".equals(clean)
                || "copilot".equals(clean)
                || "microsoft word".equals(clean)
                || "word".equals(clean)
                || "microsoft excel".equals(clean)
                || "excel".equals(clean)
                || "microsoft powerpoint".equals(clean)
                || "powerpoint".equals(clean)
                || "power point".equals(clean)
                || "microsoft onenote".equals(clean)
                || "onenote".equals(clean)
                || "one note".equals(clean)
                || "microsoft authenticator".equals(clean)
                || "company portal".equals(clean)
                || "intune company portal".equals(clean);
    }

    private static String normalizeAppName(String value) {
        return safe(value, "")
                .toLowerCase(Locale.US)
                .replaceAll("\\([^)]*\\)", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String clean(String value) {
        return safe(value, "").toLowerCase(Locale.US);
    }

    private static String safe(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
