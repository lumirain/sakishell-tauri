package com.marcel.ssh

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * 应用更新的系统通知：下载进度条 / 「已就绪」提醒。
 *
 * 纯功能：只按 Rust 侧（`src-tauri/src/updater/notify.rs`）发来的指令把通知栏摆成
 * 对应形态，不持有更新流程的任何决策。指令是 JSON，形态由 notify.rs 的 `NotifyCmd`
 * 定义（改字段名/变体名两边一起改，那边有测试钉住序列化结果）：
 *
 * - `{"kind":"downloading","version":"1.7.3","percent":42,"indeterminate":false}`
 * - `{"kind":"ready","version":"1.7.3"}`
 * - `{"kind":"clear"}`
 *
 * 入口是 [MainActivity.updateDownloadNotification]（Rust 经 JNI 调用，返回 `ok` /
 * `error:…`），投递线程由 Rust 侧负责，这里可以从任意线程调用。
 *
 * 用独立的 IMPORTANCE_LOW 通道：下载进度会反复更新，放进 Agent 通道（HIGH，弹横幅）
 * 会每次都吵用户；放进常驻服务通道又会和保活通知混在一起，用户没法单独关掉更新提示。
 * 独立通道让用户能在系统设置里单独管理「应用更新」通知。
 */
object UpdateDownloadNotifier {
    const val CHANNEL_UPDATE = "marcel_update"

    /** 与常驻保活通知（1）、Rust 侧 Agent 事件通知（100~103）错开。 */
    const val NOTIFICATION_ID = 200

    private const val TAG = "UpdateNotifier"

    private enum class Shown { NONE, DOWNLOADING, READY }

    /** 本进程发出的通知现在是什么。进程重启后归零，由 [onAppStart] 清掉遗留。 */
    @Volatile
    private var shown = Shown.NONE

    /** 创建通知通道。幂等；通道创建后 importance 不可被代码覆盖，首次必须配对。 */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_UPDATE,
            "应用更新",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "新版本的下载进度与安装提醒（无声，不弹横幅）"
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * 应用进程启动时调用：建通道，并撤掉上一个进程遗留的更新通知。
     *
     * 进程被杀时系统不会替我们收通知 —— 下载到一半被杀，常驻的进度条会永远停在
     * 旧百分比上。新进程里下载若还在继续，下一次进度变化会把它重新发出来。
     */
    fun onAppStart(context: Context) {
        ensureChannel(context)
        cancel(context)
    }

    /** 回到前台：「已就绪」提醒完成使命（用户已进入应用，浮层会接手），撤掉；进度条保留。 */
    fun onAppForeground(context: Context) {
        if (shown == Shown.READY) cancel(context)
    }

    /** 执行 Rust 侧的指令，返回 `ok` 或 `error:…`（不抛异常，JNI 里的异常会留下 pending exception）。 */
    fun apply(context: Context, payload: String): String {
        return try {
            val json = JSONObject(payload)
            when (val kind = json.getString("kind")) {
                "downloading" -> {
                    showDownloading(
                        context,
                        json.getString("version"),
                        json.optInt("percent", 0).coerceIn(0, 100),
                        json.optBoolean("indeterminate", false),
                    )
                    "ok"
                }
                "ready" -> {
                    showReady(context, json.getString("version"))
                    "ok"
                }
                "clear" -> {
                    cancel(context)
                    "ok"
                }
                else -> "error:未知的通知指令 $kind"
            }
        } catch (e: Exception) {
            Log.w(TAG, "更新通知指令执行失败: ${e.message}")
            "error:${e.message ?: "未知错误"}"
        }
    }

    private fun showDownloading(
        context: Context,
        version: String,
        percent: Int,
        indeterminate: Boolean,
    ) {
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_UPDATE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("正在下载新版本 $version")
            .setContentText(if (indeterminate) "正在下载…" else "$percent%")
            .setProgress(100, percent, indeterminate)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // 进度条跑着的时候不让划掉：划掉后用户就不知道下载还在不在进行了
            .setOngoing(true)
            // 只在第一次出现时提醒，之后的进度刷新静默
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setContentIntent(MarcelForegroundService.buildLaunchAppIntent(context))
            .build()
        if (post(context, notification)) shown = Shown.DOWNLOADING
    }

    private fun showReady(context: Context, version: String) {
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_UPDATE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("新版本 $version 已就绪")
            .setContentText("点按打开应用，确认后即可安装")
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .setLocalOnly(true)
            .setContentIntent(MarcelForegroundService.buildLaunchAppIntent(context))
            .build()
        if (post(context, notification)) shown = Shown.READY
    }

    private fun cancel(context: Context) {
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        } catch (e: Exception) {
            Log.w(TAG, "撤销更新通知失败: ${e.message}")
        }
        shown = Shown.NONE
    }

    /**
     * 发通知。没有 POST_NOTIFICATIONS 权限（Android 13+ 用户拒绝过）时系统会静默丢弃
     * 或抛 SecurityException —— 都按「没发出」处理，不影响更新流程本身：
     * 下载照常进行，设置页「关于」里仍能看到进度。
     */
    private fun post(context: Context, notification: android.app.Notification): Boolean {
        return try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "更新通知被拒绝（无通知权限）: ${e.message}")
            false
        } catch (e: Exception) {
            Log.w(TAG, "更新通知发送失败: ${e.message}")
            false
        }
    }
}
