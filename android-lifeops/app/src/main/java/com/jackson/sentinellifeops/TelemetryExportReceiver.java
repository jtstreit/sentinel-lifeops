package com.jackson.sentinellifeops;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONObject;

public class TelemetryExportReceiver extends BroadcastReceiver {
    public static final String ACTION_EXPORT_TELEMETRY = "com.jackson.sentinellifeops.EXPORT_TELEMETRY";
    private static final String TAG = "LifeOpsTelemetryExport";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_EXPORT_TELEMETRY.equals(intent.getAction())) {
            return;
        }

        PendingResult pending = goAsync();
        Context appContext = context.getApplicationContext();
        String baseUrl = intent.getStringExtra("baseUrl");
        String token = intent.getStringExtra("token");
        boolean forceRefresh = intent.getBooleanExtra("forceRefresh", true);

        new Thread(() -> {
            try {
                SentinelBridge bridge = new SentinelBridge(appContext);
                JSONObject result = bridge.exportTelemetrySnapshot(baseUrl, token, forceRefresh);
                Log.i(TAG, "Telemetry export result: " + result);
            } catch (Exception e) {
                Log.e(TAG, "Telemetry export failed", e);
            } finally {
                pending.finish();
            }
        }, "lifeops-telemetry-export").start();
    }
}
