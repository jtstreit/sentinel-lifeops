package com.jackson.sentinellifeops;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

final class SparkDriveExportManager {
    private static final String PREFS = "sentinel_spark_drive_export";
    private static final String FOLDER_URI = "folder_uri";
    private static final String FOLDER_NAME = "folder_name";
    private static final String LAST_EXPORT_AT = "last_export_at";
    private static final String LAST_EXPORT_STATUS = "last_export_status";
    private static final String LAST_EXPORT_COUNT = "last_export_count";
    private static final String LAST_EXPORT_ERROR = "last_export_error";
    private static final String LAST_MARKDOWN_FILE = "last_markdown_file";
    private static final String LAST_JSON_FILE = "last_json_file";

    private SparkDriveExportManager() {
    }

    static void saveFolder(Context context, Uri treeUri, String displayName) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(FOLDER_URI, treeUri == null ? "" : treeUri.toString())
                .putString(FOLDER_NAME, displayName == null ? "Google Drive folder" : displayName)
                .putString(LAST_EXPORT_STATUS, "configured")
                .putString(LAST_EXPORT_ERROR, "")
                .apply();
    }

    static JSONObject status(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject out = new JSONObject();
        try {
            out.put("configured", !prefs.getString(FOLDER_URI, "").isEmpty());
            out.put("folderName", prefs.getString(FOLDER_NAME, ""));
            out.put("scheduleHours", 12);
            out.put("lastExportAt", prefs.getLong(LAST_EXPORT_AT, 0L));
            out.put("lastExportStatus", prefs.getString(LAST_EXPORT_STATUS, "never"));
            out.put("lastExportCount", prefs.getInt(LAST_EXPORT_COUNT, 0));
            out.put("lastExportError", prefs.getString(LAST_EXPORT_ERROR, ""));
            out.put("latestMarkdownFile", prefs.getString(LAST_MARKDOWN_FILE, SparkCoachingBundle.latestMarkdownName()));
            out.put("latestJsonFile", prefs.getString(LAST_JSON_FILE, ""));
        } catch (Exception ignored) {
        }
        return out;
    }

    static JSONObject exportNow(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String rawUri = prefs.getString(FOLDER_URI, "");
        if (rawUri.isEmpty()) {
            return failure(context, "Google Drive folder is not configured");
        }

        try {
            DocumentFile folder = DocumentFile.fromTreeUri(context, Uri.parse(rawUri));
            if (folder == null || !folder.exists() || !folder.isDirectory() || !folder.canWrite()) {
                return failure(context, "Saved Google Drive folder permission is unavailable");
            }

            long now = System.currentTimeMillis();
            JSONObject bundle = new SentinelBridge(context).buildSparkCoachingBundle(now);
            String markdownName = SparkCoachingBundle.latestMarkdownName();
            String jsonName = SparkCoachingBundle.dailyJsonName(now);
            writeOrReplace(context, folder, markdownName, "text/markdown", SparkCoachingBundle.toMarkdown(bundle));
            writeOrReplace(context, folder, jsonName, "application/json", bundle.toString(2));

            int count = bundle.optInt("eventCount", 0);
            prefs.edit()
                    .putLong(LAST_EXPORT_AT, now)
                    .putString(LAST_EXPORT_STATUS, "success")
                    .putInt(LAST_EXPORT_COUNT, count)
                    .putString(LAST_EXPORT_ERROR, "")
                    .putString(LAST_MARKDOWN_FILE, markdownName)
                    .putString(LAST_JSON_FILE, jsonName)
                    .apply();
            return new JSONObject()
                    .put("success", true)
                    .put("eventCount", count)
                    .put("folderName", folder.getName())
                    .put("markdownFile", markdownName)
                    .put("jsonFile", jsonName)
                    .put("exportedAt", now);
        } catch (Exception error) {
            return failure(context, error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
        }
    }

    private static void writeOrReplace(Context context, DocumentFile folder, String name, String mimeType, String content) throws Exception {
        DocumentFile file = folder.findFile(name);
        if (file == null) file = folder.createFile(mimeType, name);
        if (file == null) throw new IllegalStateException("Could not create " + name);
        try (OutputStream output = context.getContentResolver().openOutputStream(file.getUri(), "rwt")) {
            if (output == null) throw new IllegalStateException("Could not open " + name);
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
    }

    private static JSONObject failure(Context context, String message) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(LAST_EXPORT_AT, System.currentTimeMillis())
                .putString(LAST_EXPORT_STATUS, "error")
                .putString(LAST_EXPORT_ERROR, message == null ? "unknown error" : message)
                .apply();
        JSONObject out = new JSONObject();
        try {
            out.put("success", false);
            out.put("error", message == null ? "unknown error" : message);
        } catch (Exception ignored) {
        }
        return out;
    }
}
