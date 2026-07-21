plugins {
    id("com.android.application")
}

android {
    namespace = "com.jackson.sentinellifeops"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jackson.sentinellifeops"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "1.3.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Background telemetry export (TelemetryExportWorker) — keeps CBT Sentinel fed
    // without the app being foregrounded.
    implementation("androidx.work:work-runtime:2.10.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
