package com.codecoverage.uploader

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 覆盖率数据上传器
 *
 * 用于将覆盖率数据上传到覆盖率平台
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
 * CoverageUploader.init(context, UploadConfig(
 *     baseUrl = "http://coverage-platform.internal",
 *     projectId = "android-app",
 *     apiKey = "your-api-key"  // 可选
 * ))
 *
 * // 上传（在协程中调用）
 * lifecycleScope.launch {
 *     val result = CoverageUploader.getInstance().uploadCoverage(
 *         coverageFile = CoverageCollector.getLatestCoverageFile(context)!!,
 *         commitHash = "abc123",
 *         branch = "main"
 *     )
 *     if (result.success) {
 *         Log.d("Upload", "Success: ${result.reportId}")
 *     }
 * }
 * ```
 */
class CoverageUploader private constructor(
    private val context: Context,
    private val baseUrl: String,
    private val projectId: String,
    private val apiKey: String?
) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * 上传配置
     *
     * @param baseUrl 平台服务地址（如 http://coverage-platform.internal）
     * @param projectId 项目 ID
     * @param apiKey API 密钥（可选，用于鉴权）
     */
    data class UploadConfig(
        val baseUrl: String,
        val projectId: String,
        val apiKey: String? = null
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

        /**
         * 初始化上传器
         *
         * @param context Android Context
         * @param config 上传配置
         */
        @JvmStatic
        fun init(context: Context, config: UploadConfig) {
            instance = CoverageUploader(
                context.applicationContext,
                config.baseUrl,
                config.projectId,
                config.apiKey
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
                "CoverageUploader not initialized. Call init() first."
            )
        }

        /**
         * 检查是否已初始化
         */
        @JvmStatic
        fun isInitialized(): Boolean = instance != null
    }

    /**
     * 上传覆盖率文件
     *
     * @param coverageFile 覆盖率文件 (.ec)
     * @param commitHash Git commit hash
     * @param branch Git 分支名
     * @param metadata 额外元数据（如测试类型、环境等）
     */
    suspend fun uploadCoverage(
        coverageFile: File,
        commitHash: String,
        branch: String,
        metadata: Map<String, String> = emptyMap()
    ): UploadResult = withContext(Dispatchers.IO) {
        try {
            if (!coverageFile.exists()) {
                return@withContext UploadResult(
                    success = false,
                    message = "Coverage file not found: ${coverageFile.absolutePath}"
                )
            }

            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "file",
                    coverageFile.name,
                    coverageFile.asRequestBody("application/octet-stream".toMediaTypeOrNull())
                )
                .addFormDataPart("projectId", projectId)
                .addFormDataPart("platform", "android")
                .addFormDataPart("commitHash", commitHash)
                .addFormDataPart("branch", branch)
                .addFormDataPart("appVersion", getAppVersion())
                .addFormDataPart("deviceInfo", getDeviceInfo())
                .addFormDataPart("fileSize", coverageFile.length().toString())
                .apply {
                    metadata.forEach { (key, value) ->
                        addFormDataPart(key, value)
                    }
                }
                .build()

            val requestBuilder = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/upload/coverage")
                .post(requestBody)

            apiKey?.let {
                requestBuilder.addHeader("X-API-Key", it)
            }

            val response = client.newCall(requestBuilder.build()).execute()

            if (response.isSuccessful) {
                val responseBody = response.body?.string()
                val json = JSONObject(responseBody ?: "{}")

                UploadResult(
                    success = true,
                    message = json.optString("message", "Upload successful"),
                    reportId = json.optString("reportId", null)
                )
            } else {
                UploadResult(
                    success = false,
                    message = "Upload failed: ${response.code} - ${response.message}"
                )
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
     * 批量上传多个覆盖率文件
     *
     * @param coverageFiles 覆盖率文件列表
     * @param commitHash Git commit hash
     * @param branch Git 分支名
     * @return 上传结果列表
     */
    suspend fun uploadMultiple(
        coverageFiles: List<File>,
        commitHash: String,
        branch: String
    ): List<UploadResult> {
        return coverageFiles.map { file ->
            uploadCoverage(file, commitHash, branch)
        }
    }

    /**
     * 上传 JSON 格式的增量覆盖率报告
     *
     * @param reportFile JSON 报告文件
     * @param commitHash Git commit hash
     * @param branch Git 分支名
     */
    suspend fun uploadReport(
        reportFile: File,
        commitHash: String,
        branch: String
    ): UploadResult = withContext(Dispatchers.IO) {
        try {
            if (!reportFile.exists()) {
                return@withContext UploadResult(
                    success = false,
                    message = "Report file not found: ${reportFile.absolutePath}"
                )
            }

            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "report",
                    reportFile.name,
                    reportFile.asRequestBody("application/json".toMediaTypeOrNull())
                )
                .addFormDataPart("projectId", projectId)
                .addFormDataPart("platform", "android")
                .addFormDataPart("commitHash", commitHash)
                .addFormDataPart("branch", branch)
                .build()

            val requestBuilder = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/upload/report")
                .post(requestBody)

            apiKey?.let {
                requestBuilder.addHeader("X-API-Key", it)
            }

            val response = client.newCall(requestBuilder.build()).execute()

            if (response.isSuccessful) {
                val responseBody = response.body?.string()
                val json = JSONObject(responseBody ?: "{}")

                UploadResult(
                    success = true,
                    message = json.optString("message", "Report uploaded"),
                    reportId = json.optString("reportId", null)
                )
            } else {
                UploadResult(
                    success = false,
                    message = "Upload failed: ${response.code} - ${response.message}"
                )
            }
        } catch (e: Exception) {
            UploadResult(
                success = false,
                message = "Error: ${e.message}"
            )
        }
    }

    private fun getAppVersion(): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            "${packageInfo.versionName}(${packageInfo.longVersionCode})"
        } catch (e: Exception) {
            "unknown"
        }
    }

    private fun getDeviceInfo(): String {
        return JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("androidVersion", Build.VERSION.RELEASE)
            put("sdkVersion", Build.VERSION.SDK_INT)
        }.toString()
    }
}