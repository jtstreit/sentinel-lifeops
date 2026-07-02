package com.jackson.sentinellifeops;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

/**
 * Periodic background telemetry export. The in-app export only runs while the WebView is
 * foregrounded (its 45s JS timer pauses in background), which meant CBT Sentinel's scheduled
 * scans usually found an empty store. This worker re-runs the same native export path
 * (SentinelBridge.exportTelemetrySnapshot) on WorkManager's schedule so telemetry keeps flowing
 * with the app closed. It reuses the base URL + token persisted by the last successful in-app
 * export; until one has happened there is nothing to do and the worker exits quietly.
 */
public class TelemetryExportWorker extends Worker {
    private static final String TAG = "LifeOpsExportWorker";

    public TelemetryExportWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String baseUrl = SentinelBridge.savedExportBaseUrl(context);
        String token = SentinelBridge.savedExportToken(context);
        if (baseUrl == null || baseUrl.trim().isEmpty()) {
            Log.i(TAG, "No export config saved yet (open the app once so an export succeeds); skipping.");
            return Result.success();
        }

        try {
            JSONObject result = new SentinelBridge(context).exportTelemetrySnapshot(baseUrl, token, true);
            boolean success = result.optBoolean("success", false);
            Log.i(TAG, "Background telemetry export: " + result);
            if (success) {
                return Result.success();
            }
            // "No telemetry logs available" is not a transient failure — nothing to send.
            String error = result.optString("error", "");
            if (error.contains("No telemetry logs available")) {
                return Result.success();
            }
            return Result.retry();
        } catch (Exception e) {
            Log.w(TAG, "Background telemetry export failed", e);
            return Result.retry();
        }
    }
}
