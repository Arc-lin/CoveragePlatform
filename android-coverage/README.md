# Android 代码覆盖率方案 (JaCoCo)

## 方案概述

Android 端采用 **JaCoCo (Java Code Coverage)** 进行代码覆盖率统计，配合 Git Diff 实现增量覆盖率分析。

**核心特性：**
- ✅ 自动收集覆盖率数据（App 进入后台/退出时）
- ✅ 自动上传到覆盖率平台
- ✅ 增量覆盖率分析（只统计变更代码）
- ✅ 时间间隔保护（防止频繁 dump）

## 整体流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ 编译时插桩   │ -> │ 运行时收集   │ -> │ 自动保存     │ -> │ 自动上传     │
│ (JaCoCo)    │    │ (探针记录)   │    │ (.ec 文件)  │    │ (平台)      │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                            ↓
                              ┌─────────────────────────────┐
                              │   CI 流程：                  │
                              │   1. 生成 JaCoCo XML 报告    │
                              │   2. 获取 Git Diff           │
                              │   3. 增量覆盖率分析          │
                              │   4. 输出报告                │
                              └─────────────────────────────┘
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `CoverageCollector.kt` | 覆盖率数据收集器，支持自动上传 |
| `CoverageUploader.kt` | 覆盖率数据上传器，使用 OkHttp |
| `incremental_coverage.py` | Python 增量覆盖率分析工具 |
| `build.gradle.example` | Gradle 配置示例 |

---

## 集成步骤

### 1. 项目 build.gradle 配置

```gradle
// 项目根目录 build.gradle
buildscript {
    dependencies {
        classpath 'org.jacoco:org.jacoco.core:0.8.11'
    }
}
```

### 2. Module build.gradle 配置

```gradle
plugins {
    id 'com.android.application'
    id 'jacoco'
}

android {
    buildTypes {
        debug {
            testCoverageEnabled true  // ⚠️ 关键：开启覆盖率
        }
    }
}

jacoco {
    toolVersion = "0.8.11"
}

dependencies {
    // CoverageUploader 依赖
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
}

task jacocoUnitTestReport(type: JacocoReport, dependsOn: ['testDebugUnitTest']) {
    reports {
        xml.required = true
        html.required = true
    }

    def fileFilter = [
        '**/R.class',
        '**/R$*.class',
        '**/BuildConfig.*',
        '**/Manifest*.*',
        '**/*Test*.*',
        'android/**/*.*'
    ]

    def debugTree = fileTree(dir: "${buildDir}/intermediates/javac/debug",
                             excludes: fileFilter)
    def kotlinDebugTree = fileTree(dir: "${buildDir}/tmp/kotlin-classes/debug",
                                   excludes: fileFilter)

    classDirectories.setFrom(files([debugTree], [kotlinDebugTree]))
    sourceDirectories.setFrom(files([
        "src/main/java",
        "src/main/kotlin"
    ]))
    executionData.setFrom(fileTree(dir: buildDir, includes: [
        'jacoco/testDebugUnitTest.exec',
        'outputs/code_coverage/debugAndroidTest/connected/**/*.ec'
    ]))
}
```

### 3. Application 初始化

```kotlin
class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // 初始化覆盖率收集器（支持自动上传）
        CoverageCollector.init(
            application = this,
            uploadConfig = CoverageUploader.UploadConfig(
                // ⚠️ Android 9+ 默认禁止明文 HTTP，生产环境请使用 https://
                // 内网使用 http:// 需在 network_security_config.xml 中配置 cleartextTrafficPermitted
                baseUrl = "https://coverage-platform.internal",
                projectId = "android-app",
                apiKey = "your-api-key"  // 可选
            ),
            gitInfo = CoverageCollector.GitInfo(
                commitHash = BuildConfig.GIT_COMMIT_HASH,  // 建议从 CI 环境变量注入
                branch = BuildConfig.GIT_BRANCH
            )
        )
    }
}
```

**Git 信息获取方式：**

在 `build.gradle` 中通过 `buildConfigField` 注入：

```gradle
android {
    defaultConfig {
        // 从 CI 环境变量获取 Git 信息
        def gitCommitHash = System.getenv("GIT_COMMIT_HASH") ?: "unknown"
        def gitBranch = System.getenv("GIT_BRANCH") ?: "unknown"

        buildConfigField "String", "GIT_COMMIT_HASH", "\"$gitCommitHash\""
        buildConfigField "String", "GIT_BRANCH", "\"$gitBranch\""
    }
}
```

CI 配置示例（Jenkins）：

```groovy
environment {
    GIT_COMMIT_HASH = sh(returnStdout: true, script: 'git rev-parse HEAD').trim()
    GIT_BRANCH = sh(returnStdout: true, script: 'git rev-parse --abbrev-ref HEAD').trim()
}
```

### 4. 运行时更新 Git 信息（可选）

如果在初始化时无法获取 Git 信息，可以在运行时更新：

```kotlin
// 从 CI 环境变量或其他来源获取后更新
CoverageCollector.updateGitInfo(
    commitHash = "abc123",
    branch = "main"
)
```

---

## 数据上传

### 自动上传

配置了 `uploadConfig` 后，CoverageCollector 会自动上传：

```kotlin
// 初始化时配置上传
CoverageCollector.init(
    application = this,
    uploadConfig = CoverageUploader.UploadConfig(baseUrl = "http://...", projectId = "..."),
    gitInfo = CoverageCollector.GitInfo(commitHash = "...", branch = "...")
)
// 之后 App 进入后台时自动 dump + 上传
```

### 手动上传

```kotlin
// 方式1：手动 dump（内部异步上传，结果不可直接获取；如需感知上传结果请用方式2）
CoverageCollector.dumpCoverage(context)

// 方式2：手动上传已有文件
lifecycleScope.launch {
    val latestFile = CoverageCollector.getLatestCoverageFile(context)
    if (latestFile != null) {
        val result = CoverageCollector.uploadCoverage(
            coverageFile = latestFile,
            commitHash = "abc123",
            branch = "main"
        )
    }
}
```

### 获取覆盖率文件路径

覆盖率文件保存在 App 私有目录：

```kotlin
// 获取目录路径
val dir = CoverageCollector.getCoverageDirPath(context)
// 输出: /data/data/<package_name>/files/coverage

// 获取所有文件
val files = CoverageCollector.getCoverageFiles(context)

// 获取最新文件
val latest = CoverageCollector.getLatestCoverageFile(context)
```

通过 adb 提取：

```bash
adb shell run-as <package_name> cat files/coverage/coverage_xxx.ec > coverage.ec
```

---

## 增量覆盖率分析

### 1. 生成 JaCoCo XML 报告

```bash
./gradlew jacocoUnitTestReport
# 报告位置: app/build/reports/jacoco/unitTest/report.xml
```

### 2. 获取 Git Diff

```bash
git diff <old_commit> <new_commit> --unified=0 > diff.patch
```

### 3. 运行增量分析

```bash
python incremental_coverage.py \
    --jacoco-report app/build/reports/jacoco/unitTest/report.xml \
    --diff-file diff.patch \
    --output incremental-report.json \
    --old-commit abc123 \
    --new-commit def456
```

### 4. 输出报告格式

```json
{
  "summary": {
    "total_files": 5,
    "total_changed_lines": 120,
    "total_covered_lines": 96,
    "total_missed_lines": 24,
    "overall_coverage_percent": 80.0,
    "threshold": 80.0,
    "status": "PASS"
  },
  "files": [
    {
      "file_path": "com/example/MainActivity.kt",
      "total_changed_lines": 30,
      "covered_lines": 28,
      "missed_lines": 2,
      "line_coverage_percent": 93.33
    }
  ]
}
```

---

## API 接口说明

### CoverageCollector

```kotlin
// 初始化
CoverageCollector.init(
    application: Application,
    uploadConfig: UploadConfig? = null,    // 上传配置（可选）
    gitInfo: GitInfo? = null,              // Git 信息（可选）
    autoUpload: Boolean = true             // 是否自动上传
)

// 手动 dump
CoverageCollector.dumpCoverage(
    context: Context,
    force: Boolean = false,                // 强制保存（忽略时间间隔）
    autoUpload: Boolean? = null            // 是否自动上传
): String?

// 手动上传（suspend 函数，需在协程中调用；@JvmStatic，Java 不可直接调用）
// Kotlin 调用: lifecycleScope.launch { CoverageCollector.uploadCoverage(...) }
@JvmStatic
suspend fun uploadCoverage(
    coverageFile: File,
    commitHash: String? = null,
    branch: String? = null
): UploadResult

// 获取文件
CoverageCollector.getCoverageFiles(context): List<File>
CoverageCollector.getLatestCoverageFile(context): File?
CoverageCollector.getCoverageDirPath(context): String

// 清除数据
CoverageCollector.clearCoverageData(context)

// 更新 Git 信息
CoverageCollector.updateGitInfo(commitHash: String, branch: String)
```

### CoverageUploader

```kotlin
// 配置
UploadConfig(
    baseUrl: String,      // 平台地址
    projectId: String,    // 项目 ID
    apiKey: String? = null  // API 密钥（可选）
)

// 上传单个文件（suspend 函数，需在协程中调用）
suspend fun uploadCoverage(
    coverageFile: File,
    commitHash: String,
    branch: String,
    metadata: Map<String, String> = emptyMap()
): UploadResult

// 批量上传（suspend 函数，需在协程中调用）
suspend fun uploadMultiple(
    coverageFiles: List<File>,
    commitHash: String,
    branch: String
): List<UploadResult>

// 上传 JSON 报告（suspend 函数，需在协程中调用）
suspend fun uploadReport(
    reportFile: File,
    commitHash: String,
    branch: String
): UploadResult
```

---

## 平台接口

### 上传覆盖率数据

```
POST /api/upload/coverage
Content-Type: multipart/form-data

参数:
- file: 覆盖率文件 (.ec)
- projectId: 项目 ID
- platform: android
- commitHash: Git commit hash
- branch: Git 分支名
- appVersion: App 版本
- deviceInfo: 设备信息 JSON
- X-API-Key: API 密钥（Header）

响应:
{
  "success": true,
  "message": "Upload successful",
  "reportId": "report_123"
}
```

### 上传增量报告

```
POST /api/upload/report
Content-Type: multipart/form-data

参数:
- report: JSON 报告文件
- projectId: 项目 ID
- platform: android
- commitHash: Git commit hash
- branch: Git 分支名
- X-API-Key: API 密钥（Header）

响应:
{
  "success": true,
  "message": "Report uploaded",
  "reportId": "report_123"
}
```

---

## 常见问题

### Q1: ClassNotFoundException: org.jacoco.agent.rt.RT

**原因：** 未开启 `testCoverageEnabled` 或 JaCoCo 版本不兼容

**解决：**
```gradle
android {
    buildTypes {
        debug {
            testCoverageEnabled true  // 必须开启
        }
    }
}
jacoco {
    toolVersion = "0.8.11"  // 使用兼容版本
}
```

### Q2: 覆盖率文件为空或 0 字节

**原因：** App 未执行到任何被插桩的代码

**解决：** 确保 App 有实际的测试操作，检查插桩范围是否正确

### Q3: 上传失败 Network error

**原因：** 网络问题或平台地址错误

**解决：**
- 检查 `baseUrl` 配置是否正确
- 确保 App 有网络权限
- 查看日志: `adb logcat -s CoverageCollector CoverageUploader`

### Q4: 增量覆盖率分析找不到文件

**原因：** Git diff 路径与 JaCoCo 报告路径不匹配

**解决：** 使用 `incremental_coverage.py` 的精确匹配功能，确保路径规范化

---

## 参考文档

- [JaCoCo 官方文档](https://www.jacoco.org/jacoco/trunk/doc/)
- [Android 测试覆盖率](https://developer.android.com/studio/test/advanced-test-setup)
- [JaCoCo Gradle 插件](https://docs.gradle.org/current/userguide/jacoco_plugin.html)