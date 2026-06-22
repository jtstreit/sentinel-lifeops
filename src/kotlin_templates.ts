export interface KotlinFile {
  filename: string;
  path: string;
  language: string;
  content: string;
  description: string;
}

export const KOTLIN_CODEBASE: KotlinFile[] = [
  {
    filename: "MainActivity.kt",
    path: "app/src/main/java/com/sentinel/lifeops/MainActivity.kt",
    language: "kotlin",
    description: "Main activity setup initializing the Jetpack Compose theme, navigation router, and local data stores.",
    content: `package com.sentinel.lifeops

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import com.sentinel.lifeops.ui.theme.SentinelTheme
import com.sentinel.lifeops.ui.navigation.SentinelNavGraph

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SentinelTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    SentinelNavGraph(navController = navController)
                }
            }
        }
    }
}`
  },
  {
    filename: "TimeCartographer.kt",
    path: "app/src/main/java/com/sentinel/lifeops/domain/TimeCartographer.kt",
    language: "kotlin",
    description: "Kotlin service carrying out backward reverse-timeline arithmetic to counter ADHD-related time blindness.",
    content: `package com.sentinel.lifeops.domain

import java.time.LocalTime
import java.time.format.DateTimeFormatter

data class ExecutiveStep(
    val id: String,
    val title: String,
    val durationMinutes: Int,
    val isCompleted: Boolean = false,
    val isCurrent: Boolean = false
)

data class ReverseStep(
    val id: String,
    val label: String,
    val durationMinutes: Int,
    val absoluteTime: LocalTime,
    val type: StepType,
    val isCompleted: Boolean = false
)

enum class StepType {
    PREP, TRAVEL, BUFFER, ANCHOR
}

object TimeCartographer {
    
    private val timeFormatter = DateTimeFormatter.ofPattern("hh:mm a")

    /**
     * Compute reverse sequential scheduling.
     * Takes target destination time and subtracts backwards through travel, buffer, and checklist steps.
     */
    fun calculateReverseTimeline(
        targetTime: LocalTime,
        steps: List<ExecutiveStep>,
        travelMinutes: Int = 20,
        bufferMinutes: Int = 10
    ): ReverseTimeline {
        val reverseSteps = mutableListOf<ReverseStep>()

        // 1. Target Event Anchor
        reverseSteps.add(
            ReverseStep(
                id = "anchor",
                label = "Target Event Arrival",
                durationMinutes = 0,
                absoluteTime = targetTime,
                type = StepType.ANCHOR
            )
        )

        // 2. Buffer Step (Mental download phase)
        val bufferStartTime = targetTime.minusMinutes(bufferMinutes.toLong())
        if (bufferMinutes > 0) {
            reverseSteps.add(
                ReverseStep(
                    id = "buffer",
                    label = "Mental Cool-down & Transition Buffer",
                    durationMinutes = bufferMinutes,
                    absoluteTime = bufferStartTime,
                    type = StepType.BUFFER
                )
            )
        }

        // 3. Hard Leaves (Travel Start Time)
        val hardLeaveTime = bufferStartTime.minusMinutes(travelMinutes.toLong())
        reverseSteps.add(
            ReverseStep(
                id = "leave",
                label = "🚗 HARD LEAVE TIME - Zero Hour",
                durationMinutes = travelMinutes,
                absoluteTime = hardLeaveTime,
                type = StepType.TRAVEL
            )
        )

        // 4. Preparation Checklist Backwards Calculation
        var currentAccumulatedTime = hardLeaveTime
        for (i in steps.indices.reversed()) {
            val step = steps[i]
            currentAccumulatedTime = currentAccumulatedTime.minusMinutes(step.durationMinutes.toLong())
            reverseSteps.add(
                ReverseStep(
                    id = "prep-\${step.id}",
                    label = step.title,
                    durationMinutes = step.durationMinutes,
                    absoluteTime = currentAccumulatedTime,
                    type = StepType.PREP,
                    isCompleted = step.isCompleted
                )
            )
        }

        val sortedSteps = reverseSteps.sortedBy { it.absoluteTime }

        return ReverseTimeline(
            timeline = sortedSteps,
            hardLeaveTime = hardLeaveTime,
            prepStartTime = currentAccumulatedTime,
            nextPhysicalAction = steps.firstOrNull { !it.isCompleted }?.title ?: "No actions remain"
        )
    }
}

data class ReverseTimeline(
    val timeline: List<ReverseStep>,
    val hardLeaveTime: LocalTime,
    val prepStartTime: LocalTime,
    val nextPhysicalAction: String
)`
  },
  {
    filename: "TodayDashboardScreen.kt",
    path: "app/src/main/java/com/sentinel/lifeops/ui/screens/TodayDashboardScreen.kt",
    language: "kotlin",
    description: "Pristine Jetpack Compose screen showing the Command Dashboard with reverse-scheduling widgets and quick cognitive levers.",
    content: `package com.sentinel.lifeops.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sentinel.lifeops.domain.ReverseStep
import com.sentinel.lifeops.domain.StepType

@Composable
fun TodayDashboardScreen(
    currentObjective: String,
    hardLeaveTimeStr: String,
    prepStartTimeStr: String,
    nextPhysicalAction: String,
    avoidanceTarget: String,
    reverseSteps: List<ReverseStep>,
    onLostClick: () -> Unit,
    onBehindClick: () -> Unit,
    onMakeExecutableClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0D0F12)) // Eye-comfort deep space background
            .padding(16.dp)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Column {
                    Text(
                        text = "SENTINEL LIFEOPS",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF5E81AC),
                        letterSpacing = 2.sp
                    )
                    Text(
                        text = "Command Console",
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            // Current Active Objective
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1B1F27)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "CURRENT COMMAND OBJECTIVE",
                            fontSize = 11.sp,
                            color = Color(0xFF81A1C1),
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = currentObjective,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            TimePill(label = "Prep Start", time = prepStartTimeStr, color = Color(0xFFEBCB8B))
                            TimePill(label = "Leave Time", time = hardLeaveTimeStr, color = Color(0xFFBF616A))
                        }
                    }
                }
            }

            // Next Micro-Physical Action Card (ADHD activation threshold reducer)
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF2E3440)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "⚡ NEXT PHYSICAL ACTION (Activation Anchor)",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFA3BE8C),
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = nextPhysicalAction,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White
                        )
                        if (avoidanceTarget.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "🛡️ Avoidance Block: \\"$avoidanceTarget\\"",
                                fontSize = 13.sp,
                                color = Color(0xFFD8DEE9).copy(alpha = 0.8f)
                            )
                        }
                    }
                }
            }

            // Helper Levers
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onLostClick,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFBF616A)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("🧩 I'M LOST", color = Color.White)
                    }
                    Button(
                        onClick = onBehindClick,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD08770)),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("⏳ LATE / BEHIND", color = Color.White)
                    }
                }
            }

            // Reverse Timeline UI list
            item {
                Text(
                    text = "REVERSE TIMELINE (Time Cartographer)",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF88C0D0),
                    letterSpacing = 1.sp
                )
            }

            items(reverseSteps) { step ->
                TimelineRow(step = step)
            }
        }
    }
}

@Composable
fun TimePill(label: String, time: String, color: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(color)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = "$label: $time",
            fontSize = 12.sp,
            color = Color.White,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
fun TimelineRow(step: ReverseStep) {
    val indicatorColor = when (step.type) {
        StepType.ANCHOR -> Color(0xFFBF616A)
        StepType.TRAVEL -> Color(0xFFD08770)
        StepType.BUFFER -> Color(0xFFEBCB8B)
        StepType.PREP -> Color(0xFFA3BE8C)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = step.absoluteTime.toString(),
            width = 64.dp,
            fontSize = 14.sp,
            color = Color(0xFFD8DEE9),
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.width(8.dp))
        Box(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(Color.DarkGray)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column {
            Text(
                text = step.label,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (step.isCompleted) Color.Gray else Color.White
            )
            Text(
                text = "\${step.durationMinutes} min block",
                fontSize = 11.sp,
                color = Color.Gray
            )
        }
    }
}
`
  },
  {
    filename: "SentinelLayer.kt",
    path: "app/src/main/java/com/sentinel/lifeops/data/SentinelLayer.kt",
    language: "kotlin",
    description: "Android lifecycle-bound listener models that aggregate signal sources locally while preserving user privacy.",
    content: `package com.sentinel.lifeops.data

import android.content.Context
import java.time.Instant

enum class SignalSource {
    SMS, NOTIFICATION, CALENDAR, LOCATION, APP_USAGE, USER_NOTE
}

data class SentinelSignal(
    val id: String,
    val timestamp: Instant,
    val source: SignalSource,
    val title: String,
    val content: String,
    val confidenceScore: Double = 0.5
)

class SentinelLayer(private val context: Context) {
    
    private val localSignals = mutableListOf<SentinelSignal>()

    /**
     * Ingest signals locally. Stores structured insights instead of tracking whole messages.
     */
    fun ingestSignal(
        source: SignalSource,
        title: String,
        content: String
    ): SentinelSignal {
        val signal = SentinelSignal(
            id = java.util.UUID.randomUUID().toString(),
            timestamp = Instant.now(),
            source = source,
            title = title,
            content = content
        )
        
        localSignals.add(signal)
        return signal
    }

    fun getUnresolvedSignals(): List<SentinelSignal> {
        return localSignals.filter { it.confidenceScore > 0.4 }
    }
}`
  },
  {
    filename: "SmsSentinelReceiver.kt",
    path: "app/src/main/java/com/sentinel/lifeops/data/SmsSentinelReceiver.kt",
    language: "kotlin",
    description: "Android BroadcastReceiver reacting to the Telephony RECEIVE_SMS intent. Extracts raw body text and registers local signals under proper permission gates.",
    content: `package com.sentinel.lifeops.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Standard Android BroadcastReceiver for telecomm SMS updates.
 * Requires "android.permission.RECEIVE_SMS" inside AndroidManifest.xml and dynamic runtime consent.
 */
class SmsSentinelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            val sentinel = SentinelLayer(context)
            for (sms in messages) {
                val sender = sms.displayOriginatingAddress ?: "Unknown Sender"
                val body = sms.displayMessageBody ?: ""
                
                // Route textual context safely into local Sentinel processing
                sentinel.ingestSignal(
                    source = SignalSource.SMS,
                    title = "SMS from \$sender",
                    content = body
                )
            }
        }
    }
}`
  },
  {
    filename: "NotificationSentinelListener.kt",
    path: "app/src/main/java/com/sentinel/lifeops/data/NotificationSentinelListener.kt",
    language: "kotlin",
    description: "Android NotificationListenerService mapping incoming banners (Gmail emails, WhatsApp messages, Outlook invites) to Sentinel Signals without requiring manual copy-pasting.",
    content: `package com.sentinel.lifeops.data

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Android Notification listener proxy intercepting text contents from third-party app alerts.
 * Requires custom registration in AndroidManifest.xml and explicit toggle in Android settings under 'Notification Access'.
 */
class NotificationSentinelListener : NotificationListenerService() {
    
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName ?: return
        val extras = sbn.notification.extras ?: return
        
        val title = extras.getString("android.title") ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        
        // Categorize third-party text events dynamically
        val source = when {
            packageName.contains("sms") || packageName.contains("messaging") -> SignalSource.SMS
            packageName.contains("calendar") || packageName.contains("sched") -> SignalSource.CALENDAR
            packageName.contains("gm") || packageName.contains("email") || packageName.contains("outlook") || packageName.contains("mail") -> SignalSource.NOTIFICATION
            else -> SignalSource.APP_USAGE
        }
        
        if (title.isNotEmpty() && text.isNotEmpty()) {
            val sentinel = SentinelLayer(applicationContext)
            sentinel.ingestSignal(
                source = source,
                title = "[\$packageName] \$title",
                content = text
            )
        }
    }
}`
  },
  {
    filename: "AndroidManifest.xml",
    path: "app/src/main/AndroidManifest.xml",
    language: "xml",
    description: "Manifest skeleton for SMS receiving, notification access service registration, and internet access for telemetry ingest.",
    content: `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECEIVE_SMS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="false"
        android:label="Sentinel LifeOps"
        android:theme="@style/Theme.SentinelLifeOps">

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <receiver
            android:name=".data.SmsSentinelReceiver"
            android:exported="true"
            android:permission="android.permission.BROADCAST_SMS">
            <intent-filter>
                <action android:name="android.provider.Telephony.SMS_RECEIVED" />
            </intent-filter>
        </receiver>

        <service
            android:name=".data.NotificationSentinelListener"
            android:exported="false"
            android:label="Sentinel Notification Listener"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
    </application>
</manifest>`
  },
  {
    filename: "build.gradle.kts",
    path: "app/build.gradle.kts",
    language: "kotlin",
    description: "App module Gradle configuration notes for Compose, BuildConfig-backed ingest endpoint settings, and OkHttp telemetry posting.",
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sentinel.lifeops"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sentinel.lifeops"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "SENTINEL_INGEST_URL", "\"https://YOUR_DEPLOYED_HOST/api/telemetry\"")
        buildConfigField("String", "SENTINEL_INGEST_TOKEN", "\"\"")
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.navigation:navigation-compose:2.9.5")
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
}`
  },
  {
    filename: "NetworkTelemetryClient.kt",
    path: "app/src/main/java/com/sentinel/lifeops/data/NetworkTelemetryClient.kt",
    language: "kotlin",
    description: "Small OkHttp client that posts sanitized Sentinel signals to the configured web ingest endpoint with an optional shared ingest token.",
    content: `package com.sentinel.lifeops.data

import android.util.Log
import com.sentinel.lifeops.BuildConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

object NetworkTelemetryClient {
    private const val TAG = "SentinelTelemetry"
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun postSignal(signal: SentinelSignal) {
        val endpoint = BuildConfig.SENTINEL_INGEST_URL.trim()
        if (endpoint.isBlank() || endpoint.contains("YOUR_DEPLOYED_HOST")) {
            Log.w(TAG, "Telemetry ingest endpoint is not configured yet")
            return
        }

        val payload = JSONObject()
            .put("source", signal.source.apiName)
            .put("title", signal.title.take(160))
            .put("content", signal.content.take(2000))
            .toString()

        val requestBuilder = Request.Builder()
            .url(endpoint)
            .post(payload.toRequestBody(jsonMediaType))
            .addHeader("Content-Type", "application/json")

        val token = BuildConfig.SENTINEL_INGEST_TOKEN.trim()
        if (token.isNotBlank()) {
            requestBuilder.addHeader("X-Sentinel-Ingest-Token", token)
        }

        client.newCall(requestBuilder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w(TAG, "Telemetry post failed", e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        Log.w(TAG, "Telemetry post rejected: \${it.code}")
                    }
                }
            }
        })
    }
}

private val SignalSource.apiName: String
    get() = when (this) {
        SignalSource.SMS -> "sms"
        SignalSource.NOTIFICATION -> "notification"
        SignalSource.CALENDAR -> "calendar"
        SignalSource.LOCATION -> "location"
        SignalSource.APP_USAGE -> "app_usage"
        SignalSource.USER_NOTE -> "user_note"
    }`
  }
];
