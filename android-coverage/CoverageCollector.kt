package com.codecoverage.collector

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.Process
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Android 代码覆盖率收集器
 * 
 * 使用方法:
 * 1. 在 Application.onCreate() 中调用 CoverageCollector.init(this)
 * 2. 在 build.gradle 中开启 testCoverageEnabled true
 * 3. 测试结束后，从 app 私有目录获取 coverage 文件
 */
class CoverageCollector {
    
    companion object {
        private const val TAG = "CoverageCollector"
        private const val COVERAGE_DIR = "coverage"
        private const val COVERAGE_FILE_EXT = ".ec"
        
        @Volatile
        private var isInitialized = false
        
        /**
         * 初始化覆盖率收集器
         */
        @JvmStatic
        fun init(application: Application) {
            if (isInitialized) return
            
            application.registerActivityLifecycleCallbacks(
                CoverageLifecycleCallbacks(application)
            )
            isInitialized = true
            
            log("CoverageCollector initialized")
        }
        
        /**
         * 手动触发覆盖率数据保存
         */
        @JvmStatic
        fun dumpCoverage(context: Context): String? {
            return try {
                val coverageFile = generateCoverageFile(context)
                
                // 通过反射调用 JaCoCo Runtime
                val runtimeClass = Class.forName("org.jacoco.agent.rt.RT")
                val getAgent = runtimeClass.getMethod("getAgent")
                val agent = getAgent.invoke(null)
                
                val dump = agent.javaClass.getMethod("dump", Boolean::class.javaPrimitiveType)
                val data = dump.invoke(agent, false) as ByteArray
                
                FileOutputStream(coverageFile).use { it.write(data) }
                
                log("Coverage data saved to: ${coverageFile.absolutePath}")
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
         * 获取所有覆盖率文件
         */
        @JvmStatic
        fun getCoverageFiles(context: Context): List<File> {
            val coverageDir = File(context.filesDir, COVERAGE_DIR)
            return coverageDir.listFiles { file ->
                file.extension == COVERAGE_FILE_EXT.trimStart('.')
            }?.toList() ?: emptyList()
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
     * 生命周期回调，自动保存覆盖率数据
     */
    private class CoverageLifecycleCallbacks(
        private val application: Application
    ) : Application.ActivityLifecycleCallbacks {
        
        private var activityCount = 0
        
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        
        override fun onActivityStarted(activity: Activity) {
            activityCount++
        }
        
        override fun onActivityResumed(activity: Activity) {}
        
        override fun onActivityPaused(activity: Activity) {}
        
        override fun onActivityStopped(activity: Activity) {
            activityCount--
            if (activityCount == 0) {
                // App 进入后台，保存覆盖率数据
                dumpCoverage(application)
            }
        }
        
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        
        override fun onActivityDestroyed(activity: Activity) {
            if (activity.isFinishing && activityCount == 0) {
                // App 即将销毁，保存覆盖率数据
                dumpCoverage(application)
            }
        }
    }
}
