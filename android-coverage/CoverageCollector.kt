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
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

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
 *                 // ⚠️ Android 9+ 默认禁止明文 HTTP，生产环境请使用 https://
 *                 baseUrl = "https://coverage-platform.internal",
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

        // 使用 AtomicBoolean 保证 init 的原子性，避免竞态导致重复注册 LifecycleCallbacks
        private val isInitialized = AtomicBoolean(false)

        // 使用 AtomicLong 保证 lastDumpTimeMs 的原子读写
        private val lastDumpTimeMs = AtomicLong(0L)

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
            // compareAndSet 保证原子性：只有第一次调用能进入，防止竞态导致重复注册
            if (!isInitialized.compareAndSet(false, true)) return

            this.uploadConfig = uploadConfig
            this.gitInfo = gitInfo

            // 如果有上传配置，初始化上传器
            uploadConfig?.let { config ->
                CoverageUploader.initOnce(application, config)
            }

            application.registerActivityLifecycleCallbacks(
                CoverageLifecycleCallbacks(application, autoUpload)
            )

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
            // 原子 CAS 检查时间间隔，防止并发重复 dump
            val currentTime = System.currentTimeMillis()
            val last = lastDumpTimeMs.get()
            if (!force && currentTime - last < MIN_DUMP_INTERVAL_MS) {
                log("Skip dump: too frequent (last dump ${currentTime - last}ms ago)")
                return null
            }
            // CAS 占位：无论 force 与否都先占位，防止 force=true 与 force=false 并发双重 dump
            if (!lastDumpTimeMs.compareAndSet(last, currentTime)) {
                if (!force) {
                    log("Skip dump: concurrent dump in progress")
                    return null
                }
                // force=true 时强制更新时间戳
                lastDumpTimeMs.set(currentTime)
            }

            var coverageFile: File? = null
            return try {
                coverageFile = generateCoverageFile(context)

                // 通过反射调用 JaCoCo Runtime
                val runtimeClass = Class.forName("org.jacoco.agent.rt.RT")
                val getAgent = runtimeClass.getMethod("getAgent")
                val agent = getAgent.invoke(null)
                    ?: run {
                        log("JaCoCo agent is null. Make sure testCoverageEnabled is true in build.gradle")
                        // 失败时重置节流时间，让下次仍可重试
                        if (!force) lastDumpTimeMs.set(last)
                        return null
                    }

                val dump = agent.javaClass.getMethod("dump", Boolean::class.javaPrimitiveType)
                val data = dump.invoke(agent, false) as? ByteArray
                if (data == null || data.isEmpty()) {
                    log("Coverage dump returned empty data")
                    coverageFile.delete()
                    if (!force) lastDumpTimeMs.set(last)
                    return null
                }

                FileOutputStream(coverageFile).use { it.write(data) }

                log("Coverage data saved to: ${coverageFile.absolutePath} (${data.size} bytes)")

                // 自动上传
                val shouldUpload = autoUpload ?: (uploadConfig != null)
                if (shouldUpload && CoverageUploader.isInitialized()) {
                    uploadCoverageAsync(coverageFile)
                }

                coverageFile.absolutePath
            } catch (e: ClassNotFoundException) {
                log("JaCoCo runtime not found. Make sure testCoverageEnabled is true in build.gradle")
                coverageFile?.delete()
                if (!force) lastDumpTimeMs.set(last)
                null
            } catch (e: NoSuchMethodException) {
                log("JaCoCo API mismatch: ${e.message}. Check JaCoCo version compatibility.")
                coverageFile?.delete()
                if (!force) lastDumpTimeMs.set(last)
                null
            } catch (e: java.lang.reflect.InvocationTargetException) {
                log("JaCoCo dump threw an exception: ${e.cause?.message}")
                e.cause?.printStackTrace()
                coverageFile?.delete()
                if (!force) lastDumpTimeMs.set(last)
                null
            } catch (e: Exception) {
                log("Failed to dump coverage: ${e.message}")
                e.printStackTrace()
                coverageFile?.delete()
                if (!force) lastDumpTimeMs.set(last)
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
                file.isFile && file.extension == COVERAGE_FILE_EXT.trimStart('.')
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
            coverageDir.listFiles()?.forEach {
                if (!it.delete()) log("Failed to delete coverage file: ${it.name}")
            }
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
        fun isInitialized(): Boolean = isInitialized.get()

        private fun generateCoverageFile(context: Context): File {
            val coverageDir = File(context.filesDir, COVERAGE_DIR)
            if (!coverageDir.exists() && !coverageDir.mkdirs()) {
                throw IOException("Failed to create coverage directory: ${coverageDir.absolutePath}")
            }

            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
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
     *
     * 使用 resumed/paused 而非 started/stopped 来计数前台 Activity，
     * 避免配置变更（屏幕旋转）时 stopped→started 顺序导致计数短暂为 0 误触发 dump。
     */
    private class CoverageLifecycleCallbacks(
        private val application: Application,
        private val autoUpload: Boolean
    ) : Application.ActivityLifecycleCallbacks {

        // 使用 resumed Activity 数量判断前台状态，避免旋转等配置变更误判
        private val resumedCount = AtomicInteger(0)

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

        override fun onActivityStarted(activity: Activity) {}

        override fun onActivityResumed(activity: Activity) {
            resumedCount.incrementAndGet()
        }

        override fun onActivityPaused(activity: Activity) {
            // 用 max(0) 防止 resumedCount 降为负数（异常重建场景）
            val count = resumedCount.updateAndGet { if (it > 0) it - 1 else 0 }
            if (count == 0) {
                // 所有 Activity 都已 paused，App 进入后台；在 IO 线程执行，避免主线程 I/O ANR
                uploadScope.launch(Dispatchers.IO) {
                    dumpCoverage(application, force = false, autoUpload = autoUpload)
                }
            }
        }

        override fun onActivityStopped(activity: Activity) {}

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

        override fun onActivityDestroyed(activity: Activity) {
            // onPaused 已处理后台 dump；此处仅在 App 完全退出且距上次 dump 超过间隔时补一次
            if (activity.isFinishing && resumedCount.get() == 0) {
                val elapsed = System.currentTimeMillis() - lastDumpTimeMs.get()
                if (elapsed >= MIN_DUMP_INTERVAL_MS) {
                    // 在 IO 线程执行，避免主线程 I/O ANR
                    uploadScope.launch(Dispatchers.IO) {
                        dumpCoverage(application, force = true, autoUpload = autoUpload)
                    }
                }
            }
        }
    }
}
