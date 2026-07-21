package com.jackson.sentinellifeops;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Locale;
import java.util.regex.Pattern;

final class MicrosoftTelemetryFilter {
    private static final Pattern MICROSOFT_BRANDED_APP = Pattern.compile("\\bmicrosoft\\s+(outlook|teams|edge|onedrive|sharepoint|office|365|copilot|word|excel|power\\s*point|powerpoint|onenote|authenticator)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_PACKAGE_PREFIX = Pattern.compile("^\\s*([a-z][a-z0-9_]*(?:\\.[a-z0-9_]+){1,})\\s*:", Pattern.CASE_INSENSITIVE);
    private static final Pattern TELEMETRY_TITLE_PREFIX = Pattern.compile("^(app usage|foreground screen text|notification from|active notification from)\\s*:?\\s*(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern WEB_CONTEXT_KEY = Pattern.compile("url|uri|host|domain|web|site|origin|provider|title", Pattern.CASE_INSENSITIVE);
    private static final Pattern MICROSOFT_WEB_HOST = Pattern.compile("(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*(?:office\\.com|office365\\.com|microsoft365\\.com|microsoftonline\\.com|cloud\\.microsoft|sharepoint\\.com|teams\\.microsoft\\.com|copilot\\.microsoft\\.com|outlook\\.live\\.com|onedrive\\.live\\.com|office\\.live\\.com|login\\.live\\.com|powerapps\\.com|powerautomate\\.com|dynamics\\.com|dynamics\\.microsoft\\.com)(?=$|[^a-z0-9.-])", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDIBLE_WEB_HOST = Pattern.compile("(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*(?:credibleinc\\.com|crediblebh\\.com)(?=$|[^a-z0-9.-])", Pattern.CASE_INSENSITIVE);
    private static final Pattern MICROSOFT_WEB_BRAND = Pattern.compile("\\b(?:microsoft\\s+(?:365|outlook|teams|sharepoint|one\\s*drive|copilot|word|excel|power\\s*point|powerpoint)|office\\s*365)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern MICROSOFT_WEB_PRODUCT = Pattern.compile("\\b(?:outlook|teams|sharepoint|one\\s*drive|power\\s*apps|power\\s*automate|dynamics\\s*365)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern MICROSOFT_WEB_UI = Pattern.compile("\\b(?:sign\\s*in|inbox|new\\s+mail|focused|calendar|files|sites|channels|chat|apps)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDIBLE_STRONG_MARKER = Pattern.compile("\\b(?:credible\\s+behavioral\\s+health|cbh3)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDIBLE_BRAND = Pattern.compile("\\bcredible\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern CREDIBLE_UI = Pattern.compile("\\b(?:client\\s+profile|employee\\s+profile|service\\s+note|sign\\s+and\\s+submit|clients|schedule|clinical|treatment\\s+plan)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern MONARCH_WORK_CONTEXT = Pattern.compile("(?:@|\\b)monarchnc\\.org\\b|\\b(?:monarch(?:\\s+nc)?|iihs?|bh[-\\s]?davidson|nc[-\\s]?topps|nctracks|providerconnect|proauth|tru\\s?care)\\b|\\b(?:client|service|progress|clinical)\\s+note\\b|\\bsign\\s+and\\s+submit\\b", Pattern.CASE_INSENSITIVE);

    private MicrosoftTelemetryFilter() {
    }

    static boolean isMicrosoftPackageName(String packageName) {
        String clean = clean(packageName);
        return "com.microsoft".equals(clean)
                || clean.startsWith("com.microsoft.")
                || "com.azure.authenticator".equals(clean)
                || clean.startsWith("com.azure.authenticator.");
    }

    static boolean isExcludedTelemetry(String source, String packageName, String title, String content, JSONObject metadata) {
        return isExcludedTelemetry(source, packageName, title, content, metadata, "");
    }

    static boolean isExcludedTelemetry(String source, String packageName, String title, String content, JSONObject metadata, String originHint) {
        if (isCredibleTelemetry(source, packageName, title, content, metadata, originHint)) return true;
        return MONARCH_WORK_CONTEXT.matcher(combinedAllContext(title, content, originHint, metadata)).find();
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

    private static boolean isMicrosoftWebTelemetry(String source, String packageName, String title, String content, JSONObject metadata, String originHint) {
        String cleanSource = clean(source);
        if (!"screen_text".equals(cleanSource) && !"notification".equals(cleanSource)) return false;
        if (!hasBrowserContext(packageName, title, metadata)) return false;

        String context = combinedContext(title, content, originHint, metadata);
        return MICROSOFT_WEB_HOST.matcher(context).find()
                || MICROSOFT_WEB_BRAND.matcher(context).find()
                || (MICROSOFT_WEB_PRODUCT.matcher(context).find() && MICROSOFT_WEB_UI.matcher(context).find());
    }

    private static boolean isCredibleTelemetry(String source, String packageName, String title, String content, JSONObject metadata, String originHint) {
        if (isCrediblePackageName(packageName) || metadataContainsPackage(metadata, true)) return true;

        String context = combinedContext(title, content, originHint, metadata);
        if (CREDIBLE_WEB_HOST.matcher(context).find() || CREDIBLE_STRONG_MARKER.matcher(context).find()) return true;
        return "screen_text".equals(clean(source))
                && hasBrowserContext(packageName, title, metadata)
                && CREDIBLE_BRAND.matcher(context).find()
                && CREDIBLE_UI.matcher(context).find();
    }

    private static boolean isCrediblePackageName(String packageName) {
        String clean = clean(packageName);
        return "com.credible".equals(clean)
                || clean.startsWith("com.credible.")
                || clean.contains(".crediblebh.")
                || clean.contains(".cbh3.");
    }

    private static boolean isBrowserPackageName(String packageName) {
        String clean = clean(packageName);
        return "com.android.chrome".equals(clean)
                || clean.startsWith("com.chrome.")
                || "com.brave.browser".equals(clean)
                || clean.startsWith("com.brave.browser_")
                || "com.sec.android.app.sbrowser".equals(clean)
                || clean.startsWith("com.sec.android.app.sbrowser.")
                || "org.mozilla.firefox".equals(clean)
                || "org.mozilla.fenix".equals(clean)
                || clean.startsWith("org.mozilla.firefox_")
                || "com.opera.browser".equals(clean)
                || clean.startsWith("com.opera.")
                || "org.chromium.chrome".equals(clean)
                || clean.startsWith("org.chromium.webapk.");
    }

    private static boolean hasBrowserContext(String packageName, String title, JSONObject metadata) {
        if (isBrowserPackageName(packageName)) return true;
        if (isBrowserPackageName(appNameFromTelemetryTitle(title))) return true;
        return metadataContainsPackage(metadata, false);
    }

    private static boolean metadataContainsPackage(JSONObject metadata, boolean credible) {
        if (metadata == null) return false;
        Iterator<String> names = metadata.keys();
        while (names.hasNext()) {
            String name = names.next();
            Object value = metadata.opt(name);
            String key = clean(name);
            boolean packageContext = key.contains("package")
                    || key.contains("process")
                    || key.contains("app")
                    || key.contains("application")
                    || key.contains("label")
                    || key.contains("source")
                    || key.contains("origin")
                    || key.contains("provider")
                    || key.contains("title");
            if (value instanceof String && packageContext) {
                String text = (String) value;
                if (credible ? isCrediblePackageName(text) : isBrowserPackageName(text)) return true;
            } else if (value instanceof JSONObject && metadataContainsPackage((JSONObject) value, credible)) {
                return true;
            }
        }
        return false;
    }

    private static String combinedContext(String title, String content, String originHint, JSONObject metadata) {
        StringBuilder out = new StringBuilder();
        appendContext(out, title);
        appendContext(out, content);
        appendContext(out, originHint);
        appendMetadataWebContext(out, metadata, "");
        return out.toString();
    }

    private static String combinedAllContext(String title, String content, String originHint, JSONObject metadata) {
        StringBuilder out = new StringBuilder();
        appendContext(out, title);
        appendContext(out, content);
        appendContext(out, originHint);
        appendMetadataAllContext(out, metadata);
        return out.toString();
    }

    private static void appendMetadataAllContext(StringBuilder out, JSONObject metadata) {
        if (metadata == null) return;
        Iterator<String> names = metadata.keys();
        while (names.hasNext()) {
            Object value = metadata.opt(names.next());
            if (value instanceof String) appendContext(out, (String) value);
            else if (value instanceof JSONObject) appendMetadataAllContext(out, (JSONObject) value);
        }
    }

    private static void appendMetadataWebContext(StringBuilder out, JSONObject metadata, String parentKey) {
        if (metadata == null) return;
        Iterator<String> names = metadata.keys();
        while (names.hasNext()) {
            String name = names.next();
            Object value = metadata.opt(name);
            boolean webContext = WEB_CONTEXT_KEY.matcher(name).find() || WEB_CONTEXT_KEY.matcher(parentKey).find();
            if (value instanceof String && webContext) {
                appendContext(out, (String) value);
            } else if (value instanceof JSONObject) {
                appendMetadataWebContext(out, (JSONObject) value, webContext ? name : parentKey);
            }
        }
    }

    private static void appendContext(StringBuilder out, String value) {
        String clean = safe(value, "");
        if (clean.isEmpty()) return;
        if (out.length() > 0) out.append(' ');
        out.append(clean);
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
