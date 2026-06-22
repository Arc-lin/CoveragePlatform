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
 * 使用前提：buildId 需要提前在平台创建好（`POST /api/builds`，上传 classfiles.zip + projectId +
 * commitHash + branch），commitHash/branch/gitDiff 都是创建 Build 时定的，上传 .ec 这一步
 * 不需要再传——所以这里的初始化参数只有 `baseUrl` 和 `buildId`，不需要 projectId/commitHash/branch。
 *
 * 依赖配置:
 * - 需要在 build.gradle 中添加 OkHttp 依赖:
 *   implementation 'com.squareup.okhttp3:okhttp:4.12.0'
 * - 需要添加 Kotlin 协程依赖:
 *   implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
 *
 * 使用示例:
 * ```kotlin
 * // 初始化
 * CoverageUploader.initOnce(application, UploadConfig(
 *     // ⚠️ Android 9+ 默认禁止明文 HTTP，生产环境请使用 https://
 *     baseUrl = "https://coverage-platform.internal",
 *     buildId = "在平台创建 Build 后拿到的 buildId"
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
    private val buildId: String
) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * 上传配置
     *
     * @param baseUrl 平台服务地址（如 https://coverage-platform.internal；Android 9+ 禁止明文 HTTP）
     * @param buildId 提前在平台创建好的 Build ID（POST /api/builds 的返回值）
     */
    data class UploadConfig(
        val baseUrl: String,
        val buildId: String
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
         * @param application Application 实例（避免 Context 泄漏，内部使用 applicationContext）
         * @param config 上传配置
         */
        @JvmStatic
        fun initOnce(application: Application, config: UploadConfig) {
            if (!initLock.compareAndSet(false, true)) return
            instance = CoverageUploader(
                application.applicationContext,
                config.baseUrl,
                config.buildId
            )
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
