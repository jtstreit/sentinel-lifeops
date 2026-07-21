package com.jackson.sentinellifeops;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

public class SparkDriveExportWorker extends Worker {
    private static final String TAG = "LifeOpsSparkDrive";

    public SparkDriveExportWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        JSONObject status = SparkDriveExportManager.status(getApplicationContext());
        if (!status.optBoolean("configured", false)) {
            Log.i(TAG, "Drive folder is not configured; skipping the scheduled export.");
            return Result.success();
        }

        JSONObject result = SparkDriveExportManager.exportNow(getApplicationContext());
        if (result.optBoolean("success", false)) {
            Log.i(TAG, "Spark coaching export completed with " + result.optInt("eventCount", 0) + " event(s).");
            return Result.success();
        }
        Log.w(TAG, "Spark coaching export failed: " + result.optString("error", "unknown error"));
        return Result.retry();
    }
}
