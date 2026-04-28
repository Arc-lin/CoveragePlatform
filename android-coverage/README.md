# Android 代码覆盖率方案 (JaCoCo)

## 方案概述

Android 端采用 **JaCoCo (Java Code Coverage)** 进行代码覆盖率统计，配合 Git Diff 实现增量覆盖率分析。

## 核心原理

1. **编译时插桩**: JaCoCo 在编译期间对字节码进行插桩，插入探针代码
2. **运行时收集**: 运行时探针记录代码执行路径
3. **数据导出**: 测试结束后生成 `.exec` 覆盖率数据文件
4. **报告生成**: 使用 JaCoCo CLI 或 Gradle 插件生成 HTML/XML/CSV 报告

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
    // ... 其他配置
    
    buildTypes {
        debug {
            testCoverageEnabled true  // 关键：开启覆盖率
        }
    }
}

jacoco {
    toolVersion = "0.8.11"
}

task jacocoTestReport(type: JacocoReport, dependsOn: ['testDebugUnitTest']) {
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


### 3. 在 Application 中初始化

```kotlin
class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CoverageCollector.init(this)
    }
}
```

## 增量覆盖率分析

### 1. 获取 Git Diff

```bash
git diff <old-commit> <new-commit> --unified=0 > diff.patch
```

### 2. 解析 Diff 获取变更文件和行号

```kotlin
// DiffParser.kt
object DiffParser {
    
    data class FileChange(
        val filePath: String,
        val changedLines: List<Int>
    )
    
    fun parseDiff(diffContent: String): List<FileChange> {
        val changes = mutableListOf<FileChange>()
        var currentFile: String? = null
        val currentLines = mutableListOf<Int>()
        
        diffContent.lines().forEach { line ->
            when {
                line.startsWith("diff --git") -> {
                    currentFile?.let {
                        changes.add(FileChange(it, currentLines.toList()))
                    }
                    currentLines.clear()
                }
                line.startsWith("+++ b/") -> {
                    currentFile = line.substringAfter("+++ b/")
                }
                line.startsWith("@@") -> {
                    // 解析 @@ 行，提取变更行号
                    // 格式: @@ -oldStart,oldCount +newStart,newCount @@
                    val matchResult = Regex("@@[^+]+\\+(\\\\d+),?(\\\\d*) @@")
                        .find(line)
                    matchResult?.let {
                        val startLine = it.groupValues[1].toInt()
                        val lineCount = it.groupValues[2].toIntOrNull() ?: 1
                        for (i in 0 until lineCount) {
                            currentLines.add(startLine + i)
                        }
                    }
                }
            }
        }
        
        currentFile?.let {
            changes.add(FileChange(it, currentLines.toList()))
        }
        
        return changes
    }
}
```

### 3. 结合 JaCoCo 报告计算增量覆盖率

```kotlin
// IncrementalCoverageAnalyzer.kt
import org.jacoco.core.analysis.*
import org.jacoco.core.data.ExecutionDataStore
import org.jacoco.core.tools.ExecFileLoader
import java.io.File

class IncrementalCoverageAnalyzer {
    
    data class CoverageResult(
        val filePath: String,
        val totalLines: Int,
        val coveredLines: Int,
        val coveragePercent: Double
    )
    
    fun analyzeIncrementalCoverage(
        execFile: File,
        classFiles: List<File>,
        sourceFiles: List<File>,
        fileChanges: List<DiffParser.FileChange>
    ): List<CoverageResult> {
        // 加载执行数据
        val loader = ExecFileLoader()
        loader.load(execFile)
        
        val executionData = loader.executionDataStore
        val coverageBuilder = CoverageBuilder()
        val analyzer = Analyzer(executionData, coverageBuilder)
        
        // 分析类文件
        classFiles.forEach { classFile ->
            analyzer.analyzeAll(classFile)
        }
        
        val results = mutableListOf<CoverageResult>()
        
        // 筛选增量文件的覆盖率
        fileChanges.forEach { change ->
            val bundle = coverageBuilder.getBundle("Coverage")
            
            bundle.packages.forEach { packageNode ->
                packageNode.sourceFiles.forEach { sourceFile ->
                    if (sourceFile.name == File(change.filePath).name) {
                        val coveredLines = mutableListOf<Int>()
                        val uncoveredLines = mutableListOf<Int>()
                        
                        change.changedLines.forEach { lineNum ->
                            val line = sourceFile.getLine(lineNum)
                            when {
                                line.isCovered -> coveredLines.add(lineNum)
                                line.isMissed -> uncoveredLines.add(lineNum)
                            }
                        }
                        
                        val total = change.changedLines.size
                        val covered = coveredLines.size
                        val percent = if (total > 0) (covered * 100.0 / total) else 0.0
                        
                        results.add(CoverageResult(
                            filePath = change.filePath,
                            totalLines = total,
                            coveredLines = covered,
                            coveragePercent = percent
                        ))
                    }
                }
            }
        }
        
        return results
    }
}
```

## 报告生成脚本

```bash
#!/bin/bash
# coverage_report.sh

EXEC_FILE=$1
OLD_COMMIT=$2
NEW_COMMIT=$3

# 1. 生成全量覆盖率报告
./gradlew jacocoTestReport

# 2. 获取 Git Diff
git diff $OLD_COMMIT $NEW_COMMIT --unified=0 > diff.patch

# 3. 运行增量覆盖率分析（Kotlin 脚本或 Java 程序）
java -jar incremental-coverage-analyzer.jar \
    --exec=$EXEC_FILE \
    --diff=diff.patch \
    --output=incremental-report.json

# 4. 生成 HTML 报告
genhtml --output-directory coverage-html full-coverage.info
```

## 上传到平台

```bash
# 上传覆盖率数据到平台
curl -X POST http://your-platform/api/upload/coverage \
  -F "projectId=1" \
  -F "commitHash=abc123" \
  -F "branch=main" \
  -F "platform=android" \
  -F "file=@coverage.exec" \
  -F "report=@coverage-report.zip"
```

## 参考文档

- [JaCoCo 官方文档](https://www.jacoco.org/jacoco/trunk/doc/)
- [Android 测试覆盖率](https://developer.android.com/studio/test/advanced-test-setup)
- [JaCoCo Gradle 插件](https://docs.gradle.org/current/userguide/jacoco_plugin.html)
