# Coverage Platform 工程接入指南

## 目录

- [平台简介](#平台简介)
- [前置准备](#前置准备)
- [方式一：自动化覆盖率采集（推荐，仅移动端）](#方式一自动化覆盖率采集推荐仅移动端)
  - [iOS 自动化接入](#ios-自动化接入)
  - [Android 自动化接入](#android-自动化接入)
- [方式二：手动上传覆盖率报告](#方式二手动上传覆盖率报告)
  - [iOS 手动上传](#ios-手动上传)
  - [Android 手动上传](#android-手动上传)
  - [Python 手动上传](#python-手动上传)
- [增量覆盖率](#增量覆盖率)
- [API 参考](#api-参考)
- [常见问题](#常见问题)

---

## 平台简介

Coverage Platform 是一个代码覆盖率收集和展示平台，支持 iOS、Android 和 Python 项目。

**平台提供两种接入方式：**

| 方式 | 适用场景 | 适用平台 | 流程 |
|------|---------|---------|------|
| **自动化采集（推荐）** | 测试人员手工测试场景 | iOS、Android | 开发接入 SDK → 打包分发 → 测试人员使用 App → 退后台自动上传 → 平台合并报告 |
| **手动上传** | CI/CD 自动化测试场景 | iOS、Android、Python | 运行测试 → 生成覆盖率文件 → 手动/脚本上传到平台 |

**核心功能：**

- 接收原始覆盖率数据（`.profraw` / `.ec` / Cobertura XML / LCOV / JSON），服务端自动解析
- 展示行级覆盖率详情（关联 GitHub 源码）
- 计算增量覆盖率（仅统计本次变更代码的覆盖情况）
- 追踪覆盖率趋势
- 同一个 Build 的多次上传自动合并为一份报告（仅移动端）

---

## 前置准备

### 1. 在平台注册项目

通过 API 创建项目（或在 Web 界面操作）：

```bash
curl -X POST http://<平台地址>:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "你的项目名",
    "platform": "ios",
    "repositoryUrl": "https://github.com/<owner>/<repo>.git"
  }'
```

> **platform 取值：** `ios`、`android` 或 `python`

返回示例：

```json
{
  "success": true,
  "data": {
    "id": "69a9aaef08b82d192c9907d3",
    "name": "MyApp",
    "platform": "ios",
    "repositoryUrl": "https://github.com/example/MyApp.git"
  }
}
```

记录返回的 `id`（即 `PROJECT_ID`），后续操作需要。

### 2. 服务端要求

自动化采集方式需要服务端安装以下工具：

| 平台 | 工具 | 用途 |
|------|------|------|
| iOS | Xcode Command Line Tools | 提供 `xcrun llvm-profdata`、`xcrun llvm-cov` |
| Android | Java Runtime | 运行 `jacococli.jar` |
| Android | `jacococli.jar` | 放置于 `backend/tools/` 目录 |

---

## 方式一：自动化覆盖率采集（推荐，仅移动端）

> **注意：** 自动化采集方式仅适用于 iOS 和 Android 移动端项目。Python 项目请使用[方式二：手动上传](#方式二手动上传覆盖率报告)。

**工作原理：**

```
                   开发者                              测试人员
                     │                                   │
    ┌────────────────┼────────────────┐    ┌─────────────┼──────────────┐
    │  1. 接入覆盖率 SDK              │    │  4. 正常使用 App            │
    │  2. 构建 Debug 包               │    │  5. 退到后台 → SDK 自动上传  │
    │  3. 上传构建产物 → 创建 Build   │    │     .profraw / .ec 到平台   │
    └────────────────┼────────────────┘    └─────────────┼──────────────┘
                     │                                   │
                     └──────────────┬────────────────────┘
                                    │
                              ┌─────┴─────┐
                              │  Coverage  │
                              │  Platform  │
                              ├───────────┤
                              │ 合并所有原始文件  │
                              │ profraw → LCOV     │
                              │ ec → JaCoCo XML    │
                              │ 生成覆盖率报告     │
                              └───────────┘
```

### iOS 自动化接入

#### Step 1: Xcode Build Settings

在项目的 Build Settings 中配置覆盖率插桩（针对 Debug 配置）：

| Setting | Value |
|---------|-------|
| `OTHER_CFLAGS` | `-fprofile-instr-generate -fcoverage-mapping` |
| `OTHER_LDFLAGS` | `-fprofile-instr-generate` |
| `OTHER_SWIFT_FLAGS` | `-profile-generate -profile-coverage-mapping` |

> **注意：** 这些配置仅在 Debug 下开启，不要用于 Release。

#### Step 2: 添加 LLVM 运行时接口

创建 `interface.h`，声明 LLVM Profile 运行时函数：

```c
// interface.h
#ifndef PROFILE_INSTRPROFILING_H_
#define PROFILE_INSTRPROFILING_H_

#import <Foundation/Foundation.h>

// https://clang.llvm.org/docs/SourceBasedCodeCoverage.html
int __llvm_profile_runtime = 0;
void __llvm_profile_initialize_file(void);
const char *__llvm_profile_get_filename(void);
void __llvm_profile_set_filename(const char *);
int __llvm_profile_write_file(void);
int __llvm_profile_register_write_file_atexit(void);
const char *__llvm_profile_get_path_prefix(void);

#endif /* PROFILE_INSTRPROFILING_H_ */
```

**Objective-C 项目：** 直接 `#import "interface.h"`
**Swift 项目：** 在 Bridging Header 中 `#import "interface.h"`

#### Step 3: 添加覆盖率 SDK

创建 `CoverageSDK.swift`：

```swift
import Foundation

@objc class CoverageSDK: NSObject {
    @objc static let shared = CoverageSDK()

    /// 平台地址
    private var serverURL: String = ""
    /// Build ID（从平台创建 Build 后获取）
    private var buildId: String = ""
    /// 测试人员标识（可选）
    private var testerName: String = ""
    /// 设备信息（可选）
    private var deviceInfo: String = ""

    /// 初始化 SDK
    /// - Parameters:
    ///   - serverURL: 平台地址，如 "http://192.168.1.100:3001"
    ///   - buildId: 平台返回的 Build ID
    ///   - moduleName: 模块名（用于 profraw 文件命名）
    ///   - testerName: 测试人员标识（可选）
    @objc func setup(serverURL: String, buildId: String, moduleName: String, testerName: String = "") {
        self.serverURL = serverURL
        self.buildId = buildId
        self.testerName = testerName
        self.deviceInfo = "\(UIDevice.current.name) (\(UIDevice.current.systemName) \(UIDevice.current.systemVersion))"

        // 设置 profraw 输出路径
        let name = "\(moduleName).profraw"
        let fileManager = FileManager.default
        do {
            let documentDirectory = try fileManager.url(
                for: .documentDirectory, in: .userDomainMask,
                appropriateFor: nil, create: false
            )
            let filePath = documentDirectory.appendingPathComponent(name).path as NSString
            __llvm_profile_set_filename(filePath.utf8String)
            print("[CoverageSDK] profraw path: \(filePath)")
        } catch {
            print("[CoverageSDK] Error setting profraw path: \(error)")
        }
    }

    /// 保存并上传覆盖率数据
    /// 建议在 App 退到后台时调用
    @objc func saveAndUpload() {
        // 1. 将内存中的覆盖率数据 flush 到 .profraw 文件
        __llvm_profile_write_file()

        // 2. 查找并上传 profraw 文件
        guard !serverURL.isEmpty, !buildId.isEmpty else {
            print("[CoverageSDK] Not configured, skip upload")
            return
        }

        let fileManager = FileManager.default
        guard let documentDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else { return }

        do {
            let files = try fileManager.contentsOfDirectory(at: documentDirectory, includingPropertiesForKeys: nil)
            let profrawFiles = files.filter { $0.pathExtension == "profraw" }

            for file in profrawFiles {
                uploadFile(file)
            }
        } catch {
            print("[CoverageSDK] Error listing files: \(error)")
        }
    }

    private func uploadFile(_ fileURL: URL) {
        guard let url = URL(string: "\(serverURL)/api/builds/\(buildId)/raw-coverage") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        let filename = fileURL.lastPathComponent

        // file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        if let fileData = try? Data(contentsOf: fileURL) {
            body.append(fileData)
        }
        body.append("\r\n".data(using: .utf8)!)

        // testerName field
        if !testerName.isEmpty {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"testerName\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(testerName)\r\n".data(using: .utf8)!)
        }

        // deviceInfo field
        if !deviceInfo.isEmpty {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"deviceInfo\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(deviceInfo)\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[CoverageSDK] Upload failed: \(error)")
                return
            }
            if let httpResponse = response as? HTTPURLResponse {
                print("[CoverageSDK] Upload response: \(httpResponse.statusCode)")
            }
        }
        task.resume()
    }
}
```

#### Step 4: 集成到 App 生命周期

**SwiftUI (Scene-based)：** 在 SceneDelegate 中调用：

```swift
// SceneDelegate.swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    // ... 现有代码 ...

    // 初始化覆盖率 SDK
    CoverageSDK.shared.setup(
        serverURL: "http://your-server:3001",
        buildId: "YOUR_BUILD_ID",    // 从平台创建 Build 后获取
        moduleName: "MyApp",
        testerName: "tester1"         // 可选
    )
}

func sceneDidEnterBackground(_ scene: UIScene) {
    // App 进入后台时自动上传覆盖率
    CoverageSDK.shared.saveAndUpload()
}
```

**UIKit (无 Scene)：** 在 AppDelegate 中调用：

```swift
func application(_ application: UIApplication, didFinishLaunchingWithOptions ...) -> Bool {
    CoverageSDK.shared.setup(
        serverURL: "http://your-server:3001",
        buildId: "YOUR_BUILD_ID",
        moduleName: "MyApp"
    )
    return true
}

func applicationDidEnterBackground(_ application: UIApplication) {
    CoverageSDK.shared.saveAndUpload()
}
```

#### Step 5: 构建并上传产物到平台

```bash
# 1. 构建 Debug App
xcodebuild build \
  -project MyApp.xcodeproj \
  -scheme MyApp \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator'

# 2. 找到 Mach-O 二进制
BINARY=$(find ~/Library/Developer/Xcode/DerivedData -name "MyApp" \
  -path "*/Debug-iphonesimulator/*.app/MyApp" -type f 2>/dev/null | head -1)

# 3. 创建 Build（上传二进制到平台）
RESPONSE=$(curl -s -X POST http://<平台地址>:3001/api/builds \
  -F "binary=@$BINARY" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)")

echo "$RESPONSE"
# 记录返回的 build.id，配置到 SDK 中
```

返回示例：

```json
{
  "success": true,
  "data": {
    "id": "683ab1c2e4f5a6b7c8d9e0f1",
    "projectId": "69a9aaef08b82d192c9907d3",
    "platform": "ios",
    "commitHash": "abc1234",
    "branch": "develop",
    "status": "ready",
    "rawUploadCount": 0
  }
}
```

**将返回的 `id` 配置到 SDK 的 `buildId` 参数中**，然后打包分发给测试人员。

#### Step 6: 测试人员使用

测试人员正常使用 App。每次 App 退到后台时，SDK 自动：

1. 将内存中的覆盖率计数器 flush 到 `.profraw` 文件
2. HTTP 上传 `.profraw` 到平台
3. 平台自动合并该 Build 下的所有 `.profraw`，更新覆盖率报告

可在平台 Web 界面的 **Builds** 页面查看 `rawUploadCount`（已上传次数）和合并后的报告。

---

### Android 自动化接入

#### Step 1: 配置 build.gradle

在 `app/build.gradle` 中开启 JaCoCo 插桩：

```groovy
plugins {
    id 'com.android.application'
    id 'jacoco'
}

android {
    buildTypes {
        debug {
            testCoverageEnabled true  // 开启覆盖率插桩
        }
    }
}

jacoco {
    toolVersion = "0.8.12"
}
```

#### Step 2: 添加覆盖率 SDK

创建 `CoverageSDK.kt`：

```kotlin
package com.example.coverage

import android.content.Context
import android.os.Build
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object CoverageSDK {
    private var serverURL: String = ""
    private var buildId: String = ""
    private var testerName: String = ""
    private var deviceInfo: String = ""
    private var context: Context? = null

    /**
     * 初始化 SDK
     * @param context Application Context
     * @param serverURL 平台地址，如 "http://192.168.1.100:3001"
     * @param buildId 平台返回的 Build ID
     * @param testerName 测试人员标识（可选）
     */
    fun setup(context: Context, serverURL: String, buildId: String, testerName: String = "") {
        this.context = context.applicationContext
        this.serverURL = serverURL
        this.buildId = buildId
        this.testerName = testerName
        this.deviceInfo = "${Build.MODEL} (Android ${Build.VERSION.RELEASE})"
    }

    /**
     * 保存并上传覆盖率数据
     * 建议在 Application.onTrimMemory(TRIM_MEMORY_UI_HIDDEN) 或 Activity.onStop 中调用
     */
    fun saveAndUpload() {
        if (serverURL.isEmpty() || buildId.isEmpty()) return

        Thread {
            try {
                // 1. Dump .ec 文件
                val ecFile = dumpCoverageData() ?: return@Thread

                // 2. 上传到平台
                uploadFile(ecFile)

                // 3. 清理临时文件
                ecFile.delete()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }

    private fun dumpCoverageData(): File? {
        return try {
            val ctx = context ?: return null
            val ecFile = File(ctx.filesDir, "coverage_${System.currentTimeMillis()}.ec")

            // 通过反射调用 JaCoCo Runtime Agent 的 dump 方法
            val agent = Class.forName("org.jacoco.agent.rt.RT")
                .getMethod("getAgent")
                .invoke(null)
            val bytes = agent.javaClass
                .getMethod("getExecutionData", Boolean::class.javaPrimitiveType)
                .invoke(agent, false) as ByteArray

            ecFile.writeBytes(bytes)
            ecFile
        } catch (e: Exception) {
            // JaCoCo agent 未加载（非插桩构建）
            null
        }
    }

    private fun uploadFile(file: File) {
        val url = URL("$serverURL/api/builds/$buildId/raw-coverage")
        val boundary = UUID.randomUUID().toString()

        val connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")

        DataOutputStream(connection.outputStream).use { out ->
            // file field
            out.writeBytes("--$boundary\r\n")
            out.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"${file.name}\"\r\n")
            out.writeBytes("Content-Type: application/octet-stream\r\n\r\n")
            FileInputStream(file).use { it.copyTo(out) }
            out.writeBytes("\r\n")

            // testerName
            if (testerName.isNotEmpty()) {
                out.writeBytes("--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"testerName\"\r\n\r\n")
                out.writeBytes("$testerName\r\n")
            }

            // deviceInfo
            if (deviceInfo.isNotEmpty()) {
                out.writeBytes("--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"deviceInfo\"\r\n\r\n")
                out.writeBytes("$deviceInfo\r\n")
            }

            out.writeBytes("--$boundary--\r\n")
        }

        val responseCode = connection.responseCode
        println("[CoverageSDK] Upload response: $responseCode")
        connection.disconnect()
    }
}
```

#### Step 3: 集成到 App 生命周期

在 `Application` 类中初始化并触发上传：

```kotlin
class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // 初始化覆盖率 SDK
        CoverageSDK.setup(
            context = this,
            serverURL = "http://your-server:3001",
            buildId = "YOUR_BUILD_ID",   // 从平台创建 Build 后获取
            testerName = "tester1"        // 可选
        )
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // App 退到后台时自动上传
        if (level == TRIM_MEMORY_UI_HIDDEN) {
            CoverageSDK.saveAndUpload()
        }
    }
}
```

> 也可以在 Activity 的 `onStop()` 中调用 `CoverageSDK.saveAndUpload()`。

#### Step 4: 构建并上传产物到平台

```bash
# 1. 构建 Debug APK
./gradlew assembleDebug

# 2. 打包 classfiles（编译后的 .class 文件）
cd app/build/intermediates/javac/debug/classes
zip -r /tmp/classfiles.zip .
cd -

# 3. 创建 Build（上传 classfiles 到平台）
RESPONSE=$(curl -s -X POST http://<平台地址>:3001/api/builds \
  -F "binary=@/tmp/classfiles.zip" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)")

echo "$RESPONSE"
# 记录返回的 build.id，配置到 SDK 中
```

**将返回的 `id` 配置到 SDK 的 `buildId` 参数中**，然后打包分发 APK 给测试人员。

#### Step 5: 测试人员使用

与 iOS 相同，测试人员正常使用 App，退后台时 SDK 自动上传 `.ec` 文件到平台。

---

## 方式二：手动上传覆盖率报告

适用于 CI/CD 自动化测试场景。开发者/CI 系统生成覆盖率文件后直接上传。

**支持的文件格式：**

| 平台 | 格式 | 说明 |
|------|------|------|
| iOS | `.info` (LCOV) | 由 `llvm-cov export -format=lcov` 生成 |
| Android | `.xml` (JaCoCo XML) | 由 JaCoCo 插件或 `jacococli.jar` 生成 |
| Python | `.xml` (Cobertura XML) | 由 `coverage xml` 生成（最常用） |
| Python | `.info` (LCOV) | 由 `coverage lcov` 生成 |
| Python | `.json` (coverage.py JSON) | 由 `coverage json` 生成 |

### iOS 手动上传

#### 1. 运行测试

```bash
xcodebuild test \
  -project MyApp.xcodeproj \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.4' \
  -enableCodeCoverage YES
```

#### 2. 导出 LCOV

```bash
DERIVED_DATA=$(xcodebuild -showBuildSettings -scheme MyApp 2>/dev/null \
  | grep BUILD_DIR | head -1 | awk '{print $3}' | sed 's|/Build/Products||')

PROFDATA=$(find "$DERIVED_DATA/Build/ProfileData" -name "Coverage.profdata" | head -1)
APP_BINARY=$(find "$DERIVED_DATA/Build/Products" -name "MyApp" \
  -path "*/Debug-iphonesimulator/*.app/*" | head -1)

xcrun llvm-cov export "$APP_BINARY" \
  -instr-profile="$PROFDATA" \
  -format=lcov > coverage.info
```

#### 3. 上传

```bash
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.info" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)"
```

### Android 手动上传

#### 1. 运行测试并生成报告

```bash
./gradlew testDebugUnitTest jacocoTestReport
```

#### 2. 上传

```bash
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)"
```

---

### Python 手动上传

Python 项目使用 `coverage.py` 工具生成覆盖率报告，然后上传到平台。

#### 前置准备

```bash
pip install coverage pytest
```

> 如使用其他测试框架（unittest、nose2 等），`coverage run` 同样适用。

#### 1. 运行测试并收集覆盖率

```bash
# 使用 pytest
coverage run -m pytest

# 或使用 unittest
coverage run -m unittest discover

# 如需指定源码目录（推荐），在 .coveragerc 中配置：
# [run]
# source = src/
# branch = true
```

#### 2. 生成覆盖率报告

支持三种输出格式，推荐使用 Cobertura XML：

```bash
# 方式 A: Cobertura XML（推荐，最常用）
coverage xml -o coverage.xml

# 方式 B: LCOV
coverage lcov -o coverage.info

# 方式 C: JSON
coverage json -o coverage.json
```

#### 3. 上传

```bash
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.xml" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)"
```

#### 4. 带增量覆盖率上传

```bash
# 生成 git diff
BASE_COMMIT=$(git merge-base origin/main HEAD)
git diff $BASE_COMMIT HEAD --unified=0 > /tmp/diff.txt

# 上传时附带 diff
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.xml" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "gitDiff=</tmp/diff.txt"
```

#### 完整示例（Makefile）

```makefile
PLATFORM_URL = http://localhost:3001
PROJECT_ID = your_project_id

.PHONY: coverage upload

coverage:
	coverage run -m pytest
	coverage xml -o coverage.xml
	coverage report  # 终端显示摘要

upload: coverage
	@BASE=$$(git merge-base origin/main HEAD); \
	git diff $$BASE HEAD --unified=0 > /tmp/diff.txt; \
	curl -X POST $(PLATFORM_URL)/api/upload/coverage \
	  -F "file=@coverage.xml" \
	  -F "projectId=$(PROJECT_ID)" \
	  -F "commitHash=$$(git rev-parse HEAD)" \
	  -F "branch=$$(git rev-parse --abbrev-ref HEAD)" \
	  -F "gitDiff=</tmp/diff.txt"
```

#### CI/CD 集成（GitHub Actions）

```yaml
name: Python Coverage

on:
  push:
    branches: [ main, develop ]
  pull_request:

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install coverage pytest

      - name: Run tests with coverage
        run: |
          coverage run -m pytest
          coverage xml -o coverage.xml

      - name: Generate git diff
        run: |
          BASE_COMMIT=$(git merge-base origin/main HEAD)
          git diff $BASE_COMMIT HEAD --unified=0 > /tmp/diff.txt

      - name: Upload to Coverage Platform
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "commitHash=${{ github.sha }}" \
            -F "branch=${{ github.ref_name }}" \
            -F "file=@coverage.xml" \
            -F "gitDiff=</tmp/diff.txt"
```

---

## 增量覆盖率

增量覆盖率衡量**本次变更的代码**被测试覆盖的程度。

### 自动化方式

创建 Build 时传入 `gitDiff`：

```bash
# 生成 diff
BASE_COMMIT=$(git merge-base origin/main HEAD)
git diff $BASE_COMMIT HEAD --unified=0 > /tmp/diff.txt

# 创建 Build 时附带 diff
curl -X POST http://<平台地址>:3001/api/builds \
  -F "binary=@$BINARY" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "gitDiff=</tmp/diff.txt"
```

后续每次 SDK 上传覆盖率数据并合并时，平台会自动计算增量覆盖率。

### 手动上传方式

上传覆盖率文件时传入 `gitDiff`：

```bash
BASE_COMMIT=$(git merge-base origin/main HEAD)
git diff $BASE_COMMIT HEAD --unified=0 > /tmp/diff.txt

curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.info" \
  -F "projectId=<PROJECT_ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "gitDiff=</tmp/diff.txt"
```

> **注意：** `gitDiff` 使用 `-F "gitDiff=</tmp/file.txt"` 语法（`<` 前无 `@`），这是 curl 的文件内容引用。

---

## API 参考

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/projects` | 创建项目 |
| `GET` | `/api/projects` | 获取所有项目 |
| `GET` | `/api/projects/:id` | 获取单个项目 |
| `PUT` | `/api/projects/:id` | 更新项目 |
| `DELETE` | `/api/projects/:id` | 删除项目 |

### Build 管理（自动化方式）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/builds` | 创建 Build（上传构建产物） |
| `POST` | `/api/builds/:buildId/raw-coverage` | 上传原始覆盖率文件（SDK 调用） |
| `GET` | `/api/builds/project/:projectId` | 获取项目的所有 Build |
| `GET` | `/api/builds/:buildId` | 获取 Build 详情 |
| `GET` | `/api/builds/:buildId/raw-uploads` | 获取 Build 的所有原始上传记录 |
| `POST` | `/api/builds/:buildId/remerge` | 强制重新合并 |
| `DELETE` | `/api/builds/:buildId` | 删除 Build |

### 手动覆盖率上传

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/upload/coverage` | 上传覆盖率报告文件 |

### 覆盖率查询

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/coverage/project/:projectId` | 获取项目的所有报告 |
| `GET` | `/api/coverage/project/:projectId/latest` | 获取最新报告 |
| `GET` | `/api/coverage/:id` | 获取报告详情 |
| `GET` | `/api/coverage/:id/files` | 获取文件列表 |
| `GET` | `/api/coverage/:id/incremental` | 获取增量覆盖率详情 |
| `GET` | `/api/coverage/:id/source?path=<filePath>` | 获取源码（从 GitHub） |

---

## 常见问题

### Q: 服务端显示 "iOS coverage conversion tools not available"？

安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

### Q: 服务端显示 "Android coverage conversion tools not available"？

1. 安装 Java Runtime：`brew install openjdk`
2. 下载 `jacococli.jar` 放到 `backend/tools/` 目录：
   - 下载地址：https://www.jacoco.org/jacoco/

### Q: profraw 上传成功但合并失败？

常见原因：
1. **Binary 不匹配**：上传的 Mach-O 二进制和 profraw 不是同一次编译的产物
2. **工具版本不兼容**：服务端的 LLVM 工具版本和编译时不同

### Q: 增量覆盖率显示为 "-"？

1. 创建 Build 或上传报告时没有传 `gitDiff` 参数
2. `gitDiff` 内容为空（没有代码变更）
3. 变更的文件不在覆盖率报告中（如只改了配置文件、资源文件）

### Q: 源码查看页面显示 "Source file not found"？

1. 确认项目的 `repositoryUrl` 配置正确
2. 确认代码已 push 到 GitHub 远程仓库
3. 确认 `commitHash` 对应的 commit 存在于远程仓库

### Q: 如何只统计业务代码，排除第三方库？

**iOS：** 在 `llvm-cov export` 时使用 `-ignore-filename-regex` 过滤：

```bash
xcrun llvm-cov export "$BINARY" \
  -instr-profile="$PROFDATA" \
  -format=lcov \
  -ignore-filename-regex='.*Pods/.*' \
  -ignore-filename-regex='.*Carthage/.*' \
  > coverage.info
```

**Android：** 在 JaCoCo 配置中设置 `excludes`：

```groovy
def fileFilter = [
    '**/R.class', '**/R$*.class',
    '**/BuildConfig.*',
    '**/databinding/**',
    '**/generated/**'
]
```

### Q: 同一个 Build 可以持续上传多次吗？

是的，这是自动化采集方式的核心特性。每次 SDK 上传新的 `.profraw` / `.ec` 文件后，平台会重新合并该 Build 下的所有原始文件，更新覆盖率报告。`rawUploadCount` 字段反映了已上传的次数。

### Q: git diff 的 `--unified=0` 是什么意思？

`--unified=0` 表示 diff 输出不包含变更行周围的上下文行，仅包含实际变更的行。这是平台解析增量覆盖率所需的格式。

### Q: Python 项目支持哪些覆盖率格式？

平台支持 coverage.py 的三种输出格式：

| 格式 | 生成命令 | 文件扩展名 | 推荐度 |
|------|---------|-----------|--------|
| Cobertura XML | `coverage xml` | `.xml` | 推荐（信息最全） |
| LCOV | `coverage lcov` | `.info` | 可用 |
| JSON | `coverage json` | `.json` | 可用 |

> 不支持直接上传 `.coverage` 二进制文件，请先转换为上述格式之一。

### Q: Python 覆盖率只统计了部分文件？

在 `.coveragerc` 或 `pyproject.toml` 中配置 `source` 参数，确保覆盖率收集范围正确：

```ini
# .coveragerc
[run]
source = src/
branch = true
```

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
branch = true
```

### Q: Python 项目的增量覆盖率不准确？

确保 Cobertura XML 中的文件路径与 git diff 中的路径能正确匹配。如果 `.coveragerc` 中配置了 `source = src/`，则 XML 中文件名可能只是 `calculator.py`（不含 `src/` 前缀），而 diff 中是 `src/calculator.py`。平台会自动进行模糊匹配，但如果项目结构复杂，建议保持一致的路径风格。
