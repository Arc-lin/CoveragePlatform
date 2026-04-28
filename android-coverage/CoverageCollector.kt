package com.codecoverage.collector

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.Process
import com.codecoverage.uploader.CoverageUploader
import com.codecoverage.uploader.CoverageUploader.UploadConfig
import com.codecoverage.uploader.CoverageUploader.UploadResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * Android 代码覆盖率收集器（支持自动上传）
 *
 * 使用方法:
 * 1. 在 Application.onCreate() 中调用 CoverageCollector.init(this, config)
 * 2. 在 build.gradle 中开启 testCoverageEnabled true
 * 3. App 进入后台或退出时，自动保存覆盖率数据并上传到平台
 *
 * 依赖配置:
 * - build.gradle 中需要配置 testCoverageEnabled true
 * - JaCoCo 版本建议 0.8.11+
 * - OkHttp: implementation 'com.squareup.okhttp3:okhttp:4.12.0'
 * - Kotlin 协程: implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
 *
 * 示例:
 * ```kotlin
 * class MyApp : Application() {
 *     override fun onCreate() {
 *         CoverageCollector.init(
 *             application = this,
 *             uploadConfig = UploadConfig(
 *                 baseUrl = "http://coverage-platform.internal",
 *                 projectId = "android-app",
 *                 apiKey = "your-api-key"
 *             ),
 *             gitInfo = GitInfo(
 *                 commitHash = "abc123",  // 可从 CI 环境变量获取
 *                 branch = "main"
 *             )
 *         )
 *     }
 * }
 * ```
 */
class CoverageCollector {

    companion object {
        private const val TAG = "CoverageCollector"
        private const val COVERAGE_DIR = "coverage"
        private const val COVERAGE_FILE_EXT = ".ec"

        // 防止频繁 dump 的最小间隔（毫秒）
        private const val MIN_DUMP_INTERVAL_MS = 30_000L  // 30秒

        @Volatile
        private var isInitialized = false

        @Volatile
        private var lastDumpTimeMs = 0L

        @Volatile
        private var uploadConfig: UploadConfig? = null

        @Volatile
        private var gitInfo: GitInfo? = null

        // 协程作用域，用于后台上传
        private val uploadScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /**
         * Git 信息
         */
        data class GitInfo(
            val commitHash: String,
            val branch: String
        )

        /**
         * 初始化配置
         */
        data class InitConfig(
            val uploadConfig: UploadConfig? = null,
            val gitInfo: GitInfo? = null,
            val autoUpload: Boolean = true  // 是否自动上传
        )

        /**
         * 初始化覆盖率收集器
         *
         * @param application Application 实例
         * @param uploadConfig 上传配置（可选，不传则不自动上传）
         * @param gitInfo Git 信息（可选，建议从 CI 环境变量获取）
         * @param autoUpload 是否在 dump 后自动上传
         */
        @JvmStatic
        fun init(
            application: Application,
            uploadConfig: UploadConfig? = null,
            gitInfo: GitInfo? = null,
            autoUpload: Boolean = true
        ) {
            if (isInitialized) return

            this.uploadConfig = uploadConfig
            this.gitInfo = gitInfo

            // 如果有上传配置，初始化上传器
            uploadConfig?.let { config ->
                CoverageUploader.init(application, config)
            }

            application.registerActivityLifecycleCallbacks(
                CoverageLifecycleCallbacks(application, autoUpload)
            )

            isInitialized = true
            log("CoverageCollector initialized (autoUpload=$autoUpload, hasUploadConfig=${uploadConfig != null})")
        }

        /**
         * 使用 InitConfig 初始化（更灵活的配置方式）
         */
        @JvmStatic
        fun init(application: Application, config: InitConfig) {
            init(
                application = application,
                uploadConfig = config.uploadConfig,
                gitInfo = config.gitInfo,
                autoUpload = config.autoUpload
            )
        }

        /**
         * 更新 Git 信息（可在运行时更新，如从 CI 环境变量获取）
         */
        @JvmStatic
        fun updateGitInfo(commitHash: String, branch: String) {
            this.gitInfo = GitInfo(commitHash, branch)
            log("Git info updated: commit=$commitHash, branch=$branch")
        }

        /**
         * 手动触发覆盖率数据保存
         *
         * @param context Context
         * @param force 是否强制保存（忽略时间间隔限制）
         * @param autoUpload 是否自动上传（默认使用初始化时的配置）
         * @return 保存的文件路径，失败返回 null
         */
        @JvmStatic
        fun dumpCoverage(
            context: Context,
            force: Boolean = false,
            autoUpload: Boolean? = null
        ): String? {
            return try {
                // 检查时间间隔，防止频繁 dump
                val currentTime = System.currentTimeMillis()
                if (!force && currentTime - lastDumpTimeMs < MIN_DUMP_INTERVAL_MS) {
                    log("Skip dump: too frequent (last dump ${currentTime - lastDumpTimeMs}ms ago)")
                    return null
                }

                val coverageFile = generateCoverageFile(context)

                // 通过反射调用 JaCoCo Runtime
                val runtimeClass = Class.forName("org.jacoco.agent.rt.RT")
                val getAgent = runtimeClass.getMethod("getAgent")
                val agent = getAgent.invoke(null)

                val dump = agent.javaClass.getMethod("dump", Boolean::class.javaPrimitiveType)
                val data = dump.invoke(agent, false) as ByteArray

                FileOutputStream(coverageFile).use { it.write(data) }

                lastDumpTimeMs = currentTime
                log("Coverage data saved to: ${coverageFile.absolutePath} (${data.size} bytes)")

                // 自动上传
                val shouldUpload = autoUpload ?: (uploadConfig != null)
                if (shouldUpload && CoverageUploader.isInitialized()) {
                    uploadCoverageAsync(coverageFile)
                }

                coverageFile.absolutePath
            } catch (e: ClassNotFoundException) {
                log("JaCoCo runtime not found. Make sure testCoverageEnabled is true in build.gradle")
                null
            } catch (e: Exception) {
                log("Failed to dump coverage: ${e.message}")
                e.printStackTrace()
                null
            }
        }

        /**
         * 手动上传覆盖率文件
         *
         * @param coverageFile 覆盖率文件
         * @param commitHash Git commit hash（可选，默认使用初始化时的配置）
         * @param branch Git 分支（可选，默认使用初始化时的配置）
         * @return 上传结果
         */
        @JvmStatic
        suspend fun uploadCoverage(
            coverageFile: File,
            commitHash: String? = null,
            branch: String? = null
        ): UploadResult {
            if (!CoverageUploader.isInitialized()) {
                return UploadResult(
                    success = false,
                    message = "CoverageUploader not initialized"
                )
            }

            val hash = commitHash ?: gitInfo?.commitHash ?: "unknown"
            val branchName = branch ?: gitInfo?.branch ?: "unknown"

            return CoverageUploader.getInstance().uploadCoverage(
                coverageFile = coverageFile,
                commitHash = hash,
                branch = branchName
            )
        }

        /**
         * 异步上传覆盖率文件（在后台协程中执行）
         */
        private fun uploadCoverageAsync(coverageFile: File) {
            uploadScope.launch {
                try {
                    val result = uploadCoverage(coverageFile)
                    if (result.success) {
                        log("Coverage uploaded successfully: reportId=${result.reportId}")
                    } else {
                        log("Coverage upload failed: ${result.message}")
                    }
                } catch (e: Exception) {
                    log("Coverage upload error: ${e.message}")
                }
            }
        }

        /**
         * 获取所有覆盖率文件
         */
        @JvmStatic
        fun getCoverageFiles(context: Context): List<File> {
            val coverageDir = File(context.filesDir, COVERAGE_DIR)
            return coverageDir.listFiles { file ->
                file.extension == COVERAGE_FILE_EXT.trimStart('.')
            }?.sortedByDescending { it.lastModified() }?.toList() ?: emptyList()
        }

        /**
         * 获取最新的覆盖率文件
         */
        @JvmStatic
        fun getLatestCoverageFile(context: Context): File? {
            return getCoverageFiles(context).firstOrNull()
        }

        /**
         * 清除所有覆盖率数据
         */
        @JvmStatic
        fun clearCoverageData(context: Context) {
            val coverageDir = File(context.filesDir, COVERAGE_DIR)
            coverageDir.listFiles()?.forEach { it.delete() }
            log("Coverage data cleared")
        }

        /**
         * 获取覆盖率文件保存目录路径
         */
        @JvmStatic
        fun getCoverageDirPath(context: Context): String {
            return File(context.filesDir, COVERAGE_DIR).absolutePath
        }

        /**
         * 检查是否已初始化
         */
        @JvmStatic
        fun isInitialized(): Boolean = isInitialized

        private fun generateCoverageFile(context: Context): File {
            val coverageDir = File(context.filesDir, COVERAGE_DIR)
            if (!coverageDir.exists()) {
                coverageDir.mkdirs()
            }

            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault())
                .format(Date())
            val pid = Process.myPid()

            return File(coverageDir, "coverage_${timestamp}_$pid$COVERAGE_FILE_EXT")
        }

        private fun log(message: String) {
            android.util.Log.d(TAG, message)
        }
    }

    /**
     * 生命周期回调，自动保存覆盖率数据并上传
     */
    private class CoverageLifecycleCallbacks(
        private val application: Application,
        private val autoUpload: Boolean
    ) : Application.ActivityLifecycleCallbacks {

        private val activityCount = AtomicInteger(0)

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

        override fun onActivityStarted(activity: Activity) {
            activityCount.incrementAndGet()
        }

        override fun onActivityResumed(activity: Activity) {}

        override fun onActivityPaused(activity: Activity) {}

        override fun onActivityStopped(activity: Activity) {
            val count = activityCount.decrementAndGet()
            if (count == 0) {
                // 所有 Activity 都 stopped，App 进入后台
                dumpCoverage(application, force = false, autoUpload = autoUpload)
            }
        }

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

        override fun onActivityDestroyed(activity: Activity) {
            val count = activityCount.get()
            if (activity.isFinishing && count == 0) {
                // App 所有 Activity 都已销毁且正在 finishing
                // 强制保存最后一次覆盖率数据
                dumpCoverage(application, force = true, autoUpload = autoUpload)
            }
        }
    }
}