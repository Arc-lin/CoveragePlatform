package com.codecoverage.uploader

import android.app.Application
import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 覆盖率数据上传器
 *
 * 用于把 CoverageCollector 落盘的 .ec 文件上传到 CoveragePlatform。
 *
 * 走的是 `POST /api/builds/:buildId/raw-coverage`（服务端按 buildId 自动合并多次上传、计算增量
 * 覆盖率），而不是 `/api/upload/coverage`（那个接口只接受已转换好的 JaCoCo XML，原始 .ec 文件会被
 * 直接拒绝）。
 *
 * buildId 不需要手动维护：初始化只需要传 baseUrl + projectId，commitHash 由 build.gradle 在编译时
 * 通过 buildConfigField 注入（见接入文档第 2.4 节，`git rev-parse HEAD` 自动取，不需要手动改代码）。
 * 首次上传时用 `(projectId, commitHash)` 调 `GET /api/builds/resolve` 换成 buildId 并缓存，后续
 * 上传复用缓存。这要求 CI/本机编译时已经用同一个 commitHash 调用过 `POST /api/builds` 上传过
 * classfiles.zip——否则 resolve 会 404，这是预期行为，说明这次构建还没有可用于解析覆盖率数据的
 * 编译产物。
 *
 * 依赖配置:
 * - build.gradle 中需要配置 testCoverageEnabled true，且注入 BuildConfig.GIT_COMMIT_HASH
 * - JaCoCo 版本建议 0.8.11+
 * - OkHttp: implementation 'com.squareup.okhttp3:okhttp:4.12.0'
 * - Kotlin 协程: implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
 *
 * 使用示例:
 * ```kotlin
 * // 初始化
 * CoverageUploader.initOnce(application, UploadConfig(
 *     // ⚠️ Android 9+ 默认禁止明文 HTTP，生产环境请使用 https://
 *     baseUrl = "https://coverage-platform.internal",
 *     projectId = "在平台创建项目后拿到的 projectId"
 * ))
 *
 * // 上传（在协程中调用）
 * lifecycleScope.launch {
 *     val latestFile = CoverageCollector.getLatestCoverageFile(context)
 *     if (latestFile != null) {
 *         val result = CoverageUploader.getInstance().uploadCoverage(latestFile)
 *         if (result.success) {
 *             Log.d("Upload", "Success: ${result.reportId}")
 *         }
 *     }
 * }
 * ```
 */
class CoverageUploader private constructor(
    private val context: Context,
    private val baseUrl: String,
    private val projectId: String,
    private val commitHash: String?
) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var cachedBuildId: String? = null

    /**
     * 上传配置
     *
     * @param baseUrl 平台服务地址（如 https://coverage-platform.internal；Android 9+ 禁止明文 HTTP）
     * @param projectId 提前在平台创建好的项目 ID
     */
    data class UploadConfig(
        val baseUrl: String,
        val projectId: String
    )

    /**
     * 上传结果
     *
     * @param success 是否成功
     * @param message 结果消息
     * @param reportId 报告 ID（成功时返回）
     */
    data class UploadResult(
        val success: Boolean,
        val message: String,
        val reportId: String? = null
    )

    companion object {
        @Volatile
        private var instance: CoverageUploader? = null

        // 保证 initOnce 的原子性，防止并发调用创建多个 OkHttpClient 实例
        private val initLock = AtomicBoolean(false)

        /**
         * 初始化上传器（幂等，只初始化一次，防止重复调用泄漏 OkHttpClient）
         *
         * commitHash 自动从 `BuildConfig.GIT_COMMIT_HASH` 读取（需要在 build.gradle 注入，
         * 见接入文档第 2.4 节）；读不到则记录警告日志，上传会全部跳过。
         *
         * @param application Application 实例（避免 Context 泄漏，内部使用 applicationContext）
         * @param config 上传配置
         * @param commitHash 可选：手动传入 commitHash（不传则尝试反射读取调用方 BuildConfig）
         */
        @JvmStatic
        @JvmOverloads
        fun initOnce(application: Application, config: UploadConfig, commitHash: String? = null) {
            if (!initLock.compareAndSet(false, true)) return
            val resolvedCommitHash = commitHash ?: readGitCommitHashFromBuildConfig(application)
            if (resolvedCommitHash == null) {
                android.util.Log.w(
                    "CoverageUploader",
                    "GIT_COMMIT_HASH not found in BuildConfig. Add buildConfigField injection " +
                        "described in the integration guide, otherwise uploads will be skipped."
                )
            }
            instance = CoverageUploader(
                application.applicationContext,
                config.baseUrl,
                config.projectId,
                resolvedCommitHash
            )
        }

        /**
         * 反射读取调用方 App 的 `<applicationId>.BuildConfig.GIT_COMMIT_HASH`
         * （SDK 自己的 BuildConfig 里没有这个字段，必须读宿主 App 的）
         */
        private fun readGitCommitHashFromBuildConfig(application: Application): String? {
            return try {
                val clazz = Class.forName("${application.packageName}.BuildConfig")
                val field = clazz.getField("GIT_COMMIT_HASH")
                field.get(null) as? String
            } catch (e: Exception) {
                null
            }
        }

        /**
         * 获取上传器实例
         *
         * @throws IllegalStateException 如果未初始化
         */
        @JvmStatic
        fun getInstance(): CoverageUploader {
            return instance ?: throw IllegalStateException(
                "CoverageUploader not initialized. Call initOnce() first."
            )
        }

        /**
         * 检查是否已初始化
         */
        @JvmStatic
        fun isInitialized(): Boolean = instance != null
    }

    /**
     * 上传覆盖率文件（.ec）
     *
     * @param coverageFile 覆盖率文件 (.ec)
     * @param testerName 测试人员标识（可选，用于服务端记录是谁触发的这次上传）
     */
    suspend fun uploadCoverage(
        coverageFile: File,
        testerName: String? = null
    ): UploadResult = withContext(Dispatchers.IO) {
        if (commitHash == null) {
            return@withContext UploadResult(
                success = false,
                message = "GIT_COMMIT_HASH not available, skipping upload"
            )
        }

        val buildId = cachedBuildId ?: resolveBuildId().also {
            if (it != null) cachedBuildId = it
        } ?: return@withContext UploadResult(
            success = false,
            message = "No build found for commit $commitHash. " +
                "Make sure CI called POST /api/builds for this commit first."
        )

        try {
            if (!coverageFile.exists()) {
                return@withContext UploadResult(
                    success = false,
                    message = "Coverage file not found: ${coverageFile.absolutePath}"
                )
            }

            val bodyBuilder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "file",
                    coverageFile.name,
                    coverageFile.asRequestBody("application/octet-stream".toMediaTypeOrNull())
                )
                .addFormDataPart("deviceInfo", getDeviceInfo())

            testerName?.let { bodyBuilder.addFormDataPart("testerName", it) }

            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/builds/$buildId/raw-coverage")
                .post(bodyBuilder.build())
                .build()

            val response = client.newCall(request).execute()

            response.use {
                if (it.isSuccessful) {
                    val responseBody = it.body?.string()
                    parseUploadResult(responseBody, "Upload successful")
                } else {
                    UploadResult(
                        success = false,
                        message = "Upload failed: HTTP ${it.code} - ${it.message}"
                    )
                }
            }
        } catch (e: IOException) {
            UploadResult(
                success = false,
                message = "Network error: ${e.message}"
            )
        } catch (e: Exception) {
            UploadResult(
                success = false,
                message = "Error: ${e.message}"
            )
        }
    }

    /**
     * 用 (projectId, commitHash) 换 buildId。第一次上传时调用，换到之后由调用方缓存。
     */
    private fun resolveBuildId(): String? {
        return try {
            val url = "${baseUrl.trimEnd('/')}/api/builds/resolve" +
                "?projectId=${java.net.URLEncoder.encode(projectId, "UTF-8")}" +
                "&commitHash=${java.net.URLEncoder.encode(commitHash, "UTF-8")}"
            val request = Request.Builder().url(url).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val json = JSONObject(response.body?.string() ?: return null)
                json.optJSONObject("data")?.optString("buildId")?.takeIf { it.isNotEmpty() }
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 批量上传多个覆盖率文件（分批并发，每批最多 3 个）
     *
     * @param coverageFiles 覆盖率文件列表
     * @return 上传结果列表
     */
    suspend fun uploadMultiple(coverageFiles: List<File>): List<UploadResult> = coroutineScope {
        coverageFiles
            .chunked(3)  // 每批最多 3 个并发，避免耗尽连接池
            .flatMap { batch ->
                batch.map { file ->
                    async { uploadCoverage(file) }
                }.map { it.await() }
            }
    }

    /**
     * 解析上传响应体，安全处理非 JSON 格式和空响应体
     */
    private fun parseUploadResult(responseBody: String?, defaultMessage: String): UploadResult {
        if (responseBody.isNullOrBlank()) {
            // HTTP 2xx 但响应体为空，无法确认服务端是否真正处理成功
            return UploadResult(
                success = false,
                message = "Server returned empty response body"
            )
        }
        return try {
            val json = JSONObject(responseBody)
            val data = json.optJSONObject("data")
            UploadResult(
                success = true,
                message = json.optString("message", defaultMessage),
                reportId = data?.optString("reportId")?.takeIf { it.isNotEmpty() }
            )
        } catch (e: JSONException) {
            // 服务端返回 HTTP 2xx 但内容非 JSON（如 CDN 错误页），视为上传失败并记录原始响应
            UploadResult(
                success = false,
                message = "Server returned non-JSON response: ${responseBody.take(200)}"
            )
        }
    }

    private fun getDeviceInfo(): String {
        return try {
            JSONObject().apply {
                put("manufacturer", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("androidVersion", Build.VERSION.RELEASE)
                put("sdkVersion", Build.VERSION.SDK_INT)
            }.toString()
        } catch (e: Exception) {
            "{}"
        }
    }
}
