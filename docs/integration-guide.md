# Coverage Platform 工程接入指南

## 目录

- [平台简介](#平台简介)
- [前置准备](#前置准备)
- [iOS 接入指南](#ios-接入指南)
- [Android 接入指南](#android-接入指南)
- [上传覆盖率数据到平台](#上传覆盖率数据到平台)
- [增量覆盖率](#增量覆盖率)
- [API 参考](#api-参考)
- [CI/CD 集成示例](#cicd-集成示例)
- [常见问题](#常见问题)

---

## 平台简介

Coverage Platform 是一个代码覆盖率收集和展示平台，支持 iOS 和 Android 项目。平台可以：

- 接收和解析覆盖率报告文件
- 展示行级覆盖率详情（关联 GitHub 源码）
- 计算增量覆盖率（仅统计本次变更代码的覆盖情况）
- 追踪覆盖率趋势

**支持的覆盖率文件格式：**

| 平台 | 支持格式 | 说明 |
|------|---------|------|
| iOS | `.info` (LCOV) | 由 `llvm-cov export -format=lcov` 生成 |
| Android | `.xml` (JaCoCo XML) | 由 JaCoCo 插件或 `jacococli.jar` 生成 |

> **注意：** `.profraw`、`.profdata`、`.ec`、`.exec` 等二进制中间文件**不能直接上传**，需先转换为上述文本格式。

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

**参数说明：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 项目名称 |
| `platform` | 是 | `ios` 或 `android` |
| `repositoryUrl` | 是 | GitHub 仓库地址（用于关联源码展示） |

**返回示例：**

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

记录返回的 `id`，后续上传时需要。

---

## iOS 接入指南

### 概述

iOS 覆盖率收集基于 LLVM Source-Based Code Coverage，完整流程：

```
Xcode 开启 Code Coverage → 运行测试 → 生成 .profraw
   → llvm-profdata merge → .profdata
   → llvm-cov export → .info (LCOV)
   → 上传到平台
```

### Step 1: Xcode 工程配置

无需修改代码或 Build Settings，只需在测试时启用 Code Coverage：

**方式 A：Xcode 界面**

1. 打开 Scheme Editor（Product → Scheme → Edit Scheme）
2. 选择 **Test** → **Options**
3. 勾选 **Code Coverage**
4. 在 Code Coverage 下选择需要统计的 Target

**方式 B：xcodebuild 命令行**

在 `xcodebuild test` 时添加 `-enableCodeCoverage YES`：

```bash
xcodebuild test \
  -project MyApp.xcodeproj \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.4' \
  -enableCodeCoverage YES
```

或使用 workspace：

```bash
xcodebuild test \
  -workspace MyApp.xcworkspace \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.4' \
  -enableCodeCoverage YES
```

### Step 2: 找到覆盖率原始数据

测试完成后，覆盖率数据保存在 DerivedData 中：

```bash
# profdata 位置
DERIVED_DATA=$(xcodebuild -showBuildSettings -scheme MyApp 2>/dev/null | grep BUILD_DIR | head -1 | awk '{print $3}' | sed 's|/Build/Products||')

# 方法1：在 Build/ProfileData 目录下查找
PROFDATA=$(find "$DERIVED_DATA/Build/ProfileData" -name "Coverage.profdata" -type f 2>/dev/null | head -1)

# 方法2：如果方法1找不到，全局搜索 DerivedData
PROFDATA=$(find ~/Library/Developer/Xcode/DerivedData -name "Coverage.profdata" -type f 2>/dev/null | sort -t/ -k1 | tail -1)

echo "profdata: $PROFDATA"
```

同时找到编译产物（Mach-O 二进制）：

```bash
# 模拟器产物路径
APP_BINARY=$(find "$DERIVED_DATA/Build/Products" -name "MyApp" -type f -path "*/Debug-iphonesimulator/*.app/*" 2>/dev/null | head -1)

echo "binary: $APP_BINARY"
```

### Step 3: 生成 LCOV 格式覆盖率报告

```bash
# 直接从 profdata 导出 LCOV（无需再 merge，Coverage.profdata 已是合并后的）
xcrun llvm-cov export \
  "$APP_BINARY" \
  -instr-profile="$PROFDATA" \
  -format=lcov \
  > coverage.info
```

如果你有的是 `.profraw` 文件（手动 dump 场景），需先合并：

```bash
# 合并 profraw → profdata
xcrun llvm-profdata merge -sparse input.profraw -o merged.profdata

# 再导出 LCOV
xcrun llvm-cov export \
  "$APP_BINARY" \
  -instr-profile=merged.profdata \
  -format=lcov \
  > coverage.info
```

### Step 4: 验证生成的文件

```bash
# 检查文件是否有效（应包含 SF: 和 DA: 记录）
head -20 coverage.info
```

输出示例：

```
SF:/Users/xxx/MyApp/MyApp/ViewController.m
FN:18,viewDidLoad
FNDA:1,viewDidLoad
FN:44,gotoStudentList
FNDA:1,gotoStudentList
DA:19,1
DA:20,1
DA:21,1
DA:22,0
end_of_record
```

### iOS 一键脚本

将以下脚本保存为 `export_coverage.sh`，放在工程根目录：

```bash
#!/bin/bash
set -e

SCHEME=${1:-"MyApp"}
DESTINATION=${2:-"platform=iOS Simulator,name=iPhone 16,OS=18.4"}

echo "=== 1. 运行测试 ==="
xcodebuild test \
  -project "${SCHEME}.xcodeproj" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -enableCodeCoverage YES \
  2>&1 | tail -5

echo "=== 2. 查找覆盖率数据 ==="
DERIVED_DATA=$(xcodebuild -showBuildSettings -scheme "$SCHEME" 2>/dev/null \
  | grep BUILD_DIR | head -1 | awk '{print $3}' | sed 's|/Build/Products||')

PROFDATA=$(find "$DERIVED_DATA/Build/ProfileData" -name "Coverage.profdata" 2>/dev/null | head -1)
APP_BINARY=$(find "$DERIVED_DATA/Build/Products" -name "$SCHEME" -type f \
  -path "*/Debug-iphonesimulator/*.app/*" 2>/dev/null | head -1)

if [ -z "$PROFDATA" ] || [ -z "$APP_BINARY" ]; then
  echo "错误：找不到覆盖率数据或二进制文件"
  exit 1
fi

echo "profdata: $PROFDATA"
echo "binary:   $APP_BINARY"

echo "=== 3. 导出 LCOV ==="
xcrun llvm-cov export "$APP_BINARY" \
  -instr-profile="$PROFDATA" \
  -format=lcov \
  > coverage.info

echo "=== 完成 ==="
echo "覆盖率文件: $(pwd)/coverage.info"
echo "文件大小: $(wc -c < coverage.info) bytes"
echo "包含文件数: $(grep -c '^SF:' coverage.info)"
```

用法：

```bash
chmod +x export_coverage.sh
./export_coverage.sh MyApp
# 或指定设备
./export_coverage.sh MyApp "platform=iOS Simulator,name=iPhone 15 Pro,OS=17.5"
```

---

## Android 接入指南

### 概述

Android 覆盖率基于 JaCoCo，完整流程：

```
build.gradle 配置 JaCoCo → 运行测试 → 生成 .exec/.ec
   → jacococli.jar report → .xml (JaCoCo XML)
   → 上传到平台
```

### Step 1: 配置 build.gradle

**模块级 `app/build.gradle`（Groovy DSL）：**

```groovy
plugins {
    id 'com.android.application'
    id 'jacoco'
}

android {
    buildTypes {
        debug {
            testCoverageEnabled true  // 关键：开启覆盖率插桩
        }
    }
}

// JaCoCo 版本配置（可选，推荐 0.8.10+）
jacoco {
    toolVersion = "0.8.12"
}

// 自定义覆盖率报告任务
task jacocoTestReport(type: JacocoReport, dependsOn: ['testDebugUnitTest']) {
    reports {
        xml.required = true        // 生成 XML（平台需要此格式）
        html.required = true       // 可选：生成 HTML 本地查看
        csv.required = false
    }

    def fileFilter = [
        '**/R.class', '**/R$*.class',
        '**/BuildConfig.*', '**/Manifest*.*',
        '**/*Test*.*', '**/AutoValue_*.*'
    ]

    def debugTree = fileTree(
        dir: "${buildDir}/intermediates/javac/debug/classes",
        excludes: fileFilter
    ) + fileTree(
        dir: "${buildDir}/tmp/kotlin-classes/debug",
        excludes: fileFilter
    )

    sourceDirectories.setFrom(files("${project.projectDir}/src/main/java",
                                     "${project.projectDir}/src/main/kotlin"))
    classDirectories.setFrom(files([debugTree]))
    executionData.setFrom(fileTree(dir: buildDir, includes: [
        'jacoco/testDebugUnitTest.exec',
        'outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec',
        'outputs/code_coverage/debugAndroidTest/connected/**/*.ec'
    ]))
}
```

**Kotlin DSL（`app/build.gradle.kts`）：**

```kotlin
plugins {
    id("com.android.application")
    id("jacoco")
}

android {
    buildTypes {
        getByName("debug") {
            enableAndroidTestCoverage = true   // Instrumented Tests
            enableUnitTestCoverage = true       // Unit Tests
        }
    }
}

jacoco {
    toolVersion = "0.8.12"
}
```

### Step 2: 运行测试并生成覆盖率

**单元测试：**

```bash
./gradlew testDebugUnitTest
```

执行数据输出位置：`app/build/jacoco/testDebugUnitTest.exec`

**Instrumented Tests（设备/模拟器上的集成测试）：**

```bash
./gradlew connectedDebugAndroidTest
```

执行数据输出位置：`app/build/outputs/code_coverage/debugAndroidTest/connected/**/*.ec`

### Step 3: 生成 JaCoCo XML 报告

**方式 A：使用 Gradle Task（推荐）**

如果已按 Step 1 配置了 `jacocoTestReport`：

```bash
./gradlew jacocoTestReport
```

XML 报告输出位置：`app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml`

**方式 B：使用 jacococli.jar 手动转换**

适用于只有 `.exec` / `.ec` 文件的场景：

```bash
# 下载 jacococli.jar（如果没有）
# https://www.jacoco.org/jacoco/trunk/doc/cli.html

java -jar jacococli.jar report app/build/jacoco/testDebugUnitTest.exec \
  --classfiles app/build/intermediates/javac/debug/classes \
  --sourcefiles app/src/main/java \
  --xml coverage.xml
```

多个 `.exec` / `.ec` 文件可以合并：

```bash
# 先合并
java -jar jacococli.jar merge \
  app/build/jacoco/testDebugUnitTest.exec \
  app/build/outputs/code_coverage/**/*.ec \
  --destfile merged.exec

# 再生成报告
java -jar jacococli.jar report merged.exec \
  --classfiles app/build/intermediates/javac/debug/classes \
  --sourcefiles app/src/main/java \
  --xml coverage.xml
```

### Step 4: 验证生成的文件

```bash
# 检查 XML 报告是否有效
head -5 coverage.xml
```

输出示例：

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="MyApp">
  <package name="com/example/myapp">
    <sourcefile name="MainActivity.kt">
```

### Android 一键脚本

将以下脚本保存为 `export_coverage.sh`，放在工程根目录：

```bash
#!/bin/bash
set -e

echo "=== 1. 运行单元测试 ==="
./gradlew testDebugUnitTest

echo "=== 2. 生成 JaCoCo XML 报告 ==="
./gradlew jacocoTestReport

REPORT_PATH="app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml"

if [ ! -f "$REPORT_PATH" ]; then
  echo "错误：找不到覆盖率报告 $REPORT_PATH"
  exit 1
fi

echo "=== 完成 ==="
echo "覆盖率文件: $(pwd)/$REPORT_PATH"
echo "文件大小: $(wc -c < "$REPORT_PATH") bytes"
```

---

## 上传覆盖率数据到平台

### 基本上传（仅全量覆盖率）

```bash
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.info" \
  -F "projectId=<项目ID>" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)"
```

**参数说明：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | 覆盖率文件（iOS: `.info`，Android: `.xml`） |
| `projectId` | 是 | 平台上的项目 ID |
| `commitHash` | 是 | 当前代码的 Git commit hash |
| `branch` | 是 | 当前 Git 分支名 |

**返回示例：**

```json
{
  "success": true,
  "message": "Coverage report uploaded successfully",
  "reportId": "69a9b0f92b8ad2a79f89209f",
  "data": {
    "lineCoverage": 20.57,
    "functionCoverage": 19.23,
    "branchCoverage": 0
  }
}
```

---

## 增量覆盖率

增量覆盖率用于衡量**本次变更的代码**被测试覆盖的程度。只关注 git diff 中新增/修改的行是否被执行到。

### 上传时携带 Git Diff

在上传覆盖率文件时，额外传入 `gitDiff` 字段：

```bash
# 1. 生成 git diff 文件
#    比较基准 commit（如 main 分支的最新 commit）和当前 commit
BASE_COMMIT=$(git merge-base origin/main HEAD)
CURRENT_COMMIT=$(git rev-parse HEAD)
git diff $BASE_COMMIT $CURRENT_COMMIT --unified=0 > /tmp/coverage_diff.txt

# 2. 上传（使用文件引用方式传递 gitDiff，避免特殊字符问题）
curl -X POST http://<平台地址>:3001/api/upload/coverage \
  -F "file=@coverage.info" \
  -F "projectId=<项目ID>" \
  -F "commitHash=$CURRENT_COMMIT" \
  -F "branch=$(git rev-parse --abbrev-ref HEAD)" \
  -F "gitDiff=</tmp/coverage_diff.txt"
```

> **重要：** `gitDiff` 参数使用 `-F "gitDiff=</tmp/file.txt"` 语法（注意 `<` 前无 `@`），这是 curl 的文件内容引用，会将文件内容作为表单字段值发送。与 `-F "file=@xxx"` 的文件上传不同。

**返回示例（含增量覆盖率）：**

```json
{
  "success": true,
  "reportId": "69a9b0f92b8ad2a79f89209f",
  "data": {
    "lineCoverage": 20.57,
    "functionCoverage": 19.23,
    "branchCoverage": 0,
    "incrementalCoverage": 15.38
  }
}
```

### 增量覆盖率计算原理

1. 解析 `gitDiff` 获取变更文件和新增行号
2. 从覆盖率报告中查找这些文件的行级覆盖数据
3. 统计变更行中被覆盖的行数比例
4. 每个变更文件独立计算增量覆盖率，最终取平均值

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

### 覆盖率上传

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/upload/coverage` | 上传覆盖率报告 |

### 覆盖率查询

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/coverage/project/:projectId` | 获取项目的所有报告 |
| `GET` | `/api/coverage/project/:projectId/latest` | 获取项目最新报告 |
| `GET` | `/api/coverage/:id` | 获取单个报告详情 |
| `GET` | `/api/coverage/:id/files` | 获取报告的文件列表 |
| `GET` | `/api/coverage/:id/files/:filePath/lines` | 获取文件行级覆盖率 |
| `GET` | `/api/coverage/:id/incremental` | 获取增量覆盖率详情 |
| `GET` | `/api/coverage/:id/source?path=<filePath>` | 获取源码（从 GitHub） |

---

## CI/CD 集成示例

### GitHub Actions — iOS

```yaml
name: iOS Coverage

on:
  pull_request:
    branches: [main]

jobs:
  coverage:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史来生成 diff

      - name: Run Tests
        run: |
          xcodebuild test \
            -project MyApp.xcodeproj \
            -scheme MyApp \
            -destination 'platform=iOS Simulator,name=iPhone 16' \
            -enableCodeCoverage YES

      - name: Export Coverage
        run: |
          DERIVED_DATA=$(xcodebuild -showBuildSettings -scheme MyApp 2>/dev/null \
            | grep BUILD_DIR | head -1 | awk '{print $3}' | sed 's|/Build/Products||')
          PROFDATA=$(find "$DERIVED_DATA/Build/ProfileData" -name "Coverage.profdata" | head -1)
          APP_BINARY=$(find "$DERIVED_DATA/Build/Products" -name "MyApp" -path "*/Debug-iphonesimulator/*.app/*" | head -1)

          xcrun llvm-cov export "$APP_BINARY" \
            -instr-profile="$PROFDATA" \
            -format=lcov > coverage.info

      - name: Generate Diff
        run: |
          git diff origin/main...HEAD --unified=0 > /tmp/coverage_diff.txt

      - name: Upload to Coverage Platform
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "file=@coverage.info" \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "commitHash=${{ github.event.pull_request.head.sha }}" \
            -F "branch=${{ github.head_ref }}" \
            -F "gitDiff=</tmp/coverage_diff.txt"
```

### GitHub Actions — Android

```yaml
name: Android Coverage

on:
  pull_request:
    branches: [main]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Run Tests & Generate Report
        run: |
          ./gradlew testDebugUnitTest jacocoTestReport

      - name: Generate Diff
        run: |
          git diff origin/main...HEAD --unified=0 > /tmp/coverage_diff.txt

      - name: Upload to Coverage Platform
        run: |
          curl -X POST ${{ secrets.COVERAGE_PLATFORM_URL }}/api/upload/coverage \
            -F "file=@app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml" \
            -F "projectId=${{ secrets.PROJECT_ID }}" \
            -F "commitHash=${{ github.event.pull_request.head.sha }}" \
            -F "branch=${{ github.head_ref }}" \
            -F "gitDiff=</tmp/coverage_diff.txt"
```

### Fastlane 集成（iOS）

```ruby
# Fastfile
lane :coverage do
  scan(
    scheme: "MyApp",
    code_coverage: true,
    output_types: "",
    fail_build: false
  )

  # 导出 LCOV 和上传的逻辑通过 sh 调用
  sh("cd .. && ./export_coverage.sh MyApp && ./upload_coverage.sh")
end
```

---

## 常见问题

### Q: 上传 .profraw / .profdata 报错？

平台不支持直接解析二进制格式。请先转换为 LCOV：

```bash
# profraw → profdata
xcrun llvm-profdata merge -sparse input.profraw -o output.profdata

# profdata → LCOV
xcrun llvm-cov export <binary> -instr-profile=output.profdata -format=lcov > coverage.info
```

### Q: 上传 .exec / .ec 报错？

平台不支持直接解析 JaCoCo 二进制格式。请先转换为 XML：

```bash
java -jar jacococli.jar report input.exec \
  --classfiles app/build/intermediates/javac/debug/classes \
  --xml coverage.xml
```

### Q: 增量覆盖率显示为 "-"？

可能原因：
1. 上传时没有传 `gitDiff` 参数
2. `gitDiff` 内容为空（没有代码变更）
3. 变更的文件不在覆盖率报告中（如只改了配置文件、资源文件）

### Q: 源码查看页面显示 "Source file not found"？

1. 确认项目的 `repositoryUrl` 配置正确
2. 确认代码已 push 到 GitHub 远程仓库
3. 确认 `commitHash` 对应的 commit 存在于远程仓库

### Q: 覆盖率报告中的文件路径是绝对路径怎么办？

iOS LCOV 报告中的文件路径通常是编译机器上的绝对路径（如 `/Users/xxx/MyApp/...`），这是正常的。平台会自动将绝对路径转换为 GitHub 相对路径来获取源码。

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

### Q: git diff 的 --unified=0 是什么意思？

`--unified=0` 表示上下文行数为 0，diff 输出只包含实际变更的行，不包含变更行周围的上下文。这是平台解析增量覆盖率所需的格式，确保只统计真正变更的行号。
