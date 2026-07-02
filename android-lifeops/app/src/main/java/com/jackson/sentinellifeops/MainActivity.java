package com.jackson.sentinellifeops;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST_CODE = 8042;
    private static final String APP_HOST = "sentinel.lifeops.local";
    private static final String LIFEOPS_API_HOST = "sentinel-lifeops-api.onrender.com";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return interceptAssetRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return interceptAssetRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return shouldBlockOrExternalizeNavigation(request == null ? null : request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return shouldBlockOrExternalizeNavigation(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new SentinelBridge(this), "SentinelAndroid");

        setContentView(webView);
        applySystemBarInsets();
        requestCorePermissions();
        scheduleBackgroundTelemetryExport();
        webView.loadUrl(APP_URL);
    }

    // Keep CBT Sentinel fed while the app is closed: the WebView's 45s export timer only runs
    // foregrounded, so a periodic worker re-exports on WorkManager's schedule (30 min is the
    // freshness/battery balance; CBT scans 6-hourly). UPDATE policy lets interval/constraint
    // changes in a new APK take effect without a reinstall dance.
    private void scheduleBackgroundTelemetryExport() {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                TelemetryExportWorker.class, 30, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build())
                .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "lifeops-telemetry-export",
                ExistingPeriodicWorkPolicy.UPDATE,
                request);
    }

    private void applySystemBarInsets() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        }
        webView.setFitsSystemWindows(true);
    }

    public void requestCorePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        List<String> missing = new ArrayList<>();
        addIfMissing(missing, Manifest.permission.READ_SMS);
        addIfMissing(missing, Manifest.permission.READ_CALL_LOG);
        addIfMissing(missing, Manifest.permission.READ_CONTACTS);
        addIfMissing(missing, Manifest.permission.READ_CALENDAR);
        addIfMissing(missing, Manifest.permission.ACCESS_COARSE_LOCATION);
        addIfMissing(missing, Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            addIfMissing(missing, Manifest.permission.POST_NOTIFICATIONS);
        }

        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    private void addIfMissing(List<String> missing, String permission) {
        if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            missing.add(permission);
        }
    }

    private WebResourceResponse interceptAssetRequest(Uri uri) {
        if (uri == null) {
            return emptyResponse(403);
        }

        if (!APP_HOST.equals(uri.getHost())) {
            return shouldAllowNetworkRequest(uri) ? null : emptyResponse(403);
        }

        String path = uri.getPath();
        if (path == null || path.equals("/") || path.isEmpty()) {
            path = "/index.html";
        }
        String assetPath = "web" + path;

        try {
            InputStream stream = getAssets().open(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "https://" + APP_HOST);
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(
                    mimeTypeFor(assetPath),
                    assetPath.endsWith(".html") || assetPath.endsWith(".css") || assetPath.endsWith(".js") ? "UTF-8" : null,
                    200,
                    "OK",
                    headers,
                    stream
            );
        } catch (Exception ignored) {
            return emptyResponse(404);
        }
    }

    private boolean shouldBlockOrExternalizeNavigation(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        if ("https".equals(scheme) && APP_HOST.equals(uri.getHost())) {
            return false;
        }
        if ("http".equals(scheme) || "https".equals(scheme)) {
            try {
                Intent external = new Intent(Intent.ACTION_VIEW, uri);
                external.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(external);
            } catch (Exception ignored) {
            }
        }
        return true;
    }

    private WebResourceResponse emptyResponse(int statusCode) {
        String reason = statusCode == 404 ? "Not Found" : "Blocked";
        return new WebResourceResponse("text/plain", "UTF-8", statusCode, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private boolean shouldAllowNetworkRequest(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        if ("https".equals(scheme) && LIFEOPS_API_HOST.equals(host)) {
            return true;
        }
        return "http".equals(scheme) && isLocalNetworkHost(host);
    }

    private boolean isLocalNetworkHost(String host) {
        return "localhost".equals(host)
                || "127.0.0.1".equals(host)
                || host.startsWith("10.")
                || host.startsWith("192.168.")
                || host.matches("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*");
    }

    private String mimeTypeFor(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
