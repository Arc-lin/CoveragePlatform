package com.codecoverage.uploader

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 覆盖率数据上传器
 * 
 * 用于将覆盖率数据上传到覆盖率平台
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
    
    data class UploadConfig(
        val baseUrl: String,
        val projectId: String,
        val apiKey: String? = null
    )
    
    data class UploadResult(
        val success: Boolean,
        val message: String,
        val reportId: String? = null
    )
    
    companion object {
        @Volatile
        private var instance: CoverageUploader? = null
        
        @JvmStatic
        fun init(context: Context, config: UploadConfig) {
            instance = CoverageUploader(
                context.applicationContext,
                config.baseUrl,
                config.projectId,
                config.apiKey
            )
        }
        
        @JvmStatic
        fun getInstance(): CoverageUploader {
            return instance ?: throw IllegalStateException(
                "CoverageUploader not initialized. Call init() first."
            )
        }
    }
    
    /**
     * 上传覆盖率文件
     * 
     * @param coverageFile 覆盖率文件 (.ec)
     * @param commitHash Git commit hash
     * @param branch Git 分支名
     * @param metadata 额外元数据
     */
    suspend fun uploadCoverage(
        coverageFile: File,
        commitHash: String,
        branch: String,
        metadata: Map<String, String> = emptyMap()
    ): UploadResult = withContext(Dispatchers.IO) {
        try {
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
                .apply {
                    metadata.forEach { (key, value) ->
                        addFormDataPart(key, value)
                    }
                }
                .build()
            
            val requestBuilder = Request.Builder()
                .url("$baseUrl/api/upload/coverage")
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
