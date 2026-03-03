# iOS 代码覆盖率方案 (LLVM Sanitizer Coverage)

## 方案概述

iOS 端采用 **LLVM Sanitizer Coverage** 进行代码覆盖率统计，配合 Git Diff 实现增量覆盖率分析。

## 核心原理

1. **编译时插桩**: 通过编译参数 `-sanitize-coverage=func,trace-pc-guard` 在编译期间插入探针
2. **运行时回调**: 程序执行时通过 `__sanitizer_cov_trace_pc_guard` 回调记录代码执行
3. **数据导出**: 使用 LLVM Profile 功能导出 `.profraw` 覆盖率数据文件
4. **报告生成**: 使用 `llvm-cov` 和 `llvm-profdata` 工具链生成报告

## 集成步骤

### 1. Xcode 编译参数配置

#### Objective-C 项目

在 Build Settings 中配置：

**Other C Flags** 添加：
```
-fprofile-instr-generate -fcoverage-mapping
```

或 Sanitizer Coverage 方式：
```
-sanitize-coverage=func,trace-pc-guard
```

#### Swift 项目

**Other Swift Flags** 添加：
```
-sanitize-coverage=func
-sanitize=undefined
```

**Other Linker Flags** 添加：
```
-fprofile-instr-generate
```

### 2. 插桩回调实现

创建 `CoverageCollector.m` 文件：

```objc
// CoverageCollector.m
#import <Foundation/Foundation.h>
#import <dlfcn.h>

// 声明 LLVM Profile 函数
extern int __llvm_profile_runtime;
void __llvm_profile_initialize_file(void);
const char *__llvm_profile_get_filename(void);
void __llvm_profile_set_filename(const char *);
int __llvm_profile_write_file(void);
int __llvm_profile_register_write_file_atexit(void);

// Sanitizer Coverage 回调
void __sanitizer_cov_trace_pc_guard_init(uint32_t *start, uint32_t *stop) {
    static uint64_t N;
    if (start == stop || *start) return;
    for (uint32_t *x = start; x < stop; x++) {
        *x = ++N;
    }
}

void __sanitizer_cov_trace_pc_guard(uint32_t *guard) {
    void *PC = __builtin_return_address(0);
    Dl_info info;
    dladdr(PC, &info);
    // 可选：记录调用信息
    // NSLog(@"Function: %s", info.dli_sname);
}

@implementation CoverageCollector

+ (void)initialize {
    // 设置覆盖率数据输出路径
    NSString *name = [NSString stringWithFormat:@"%@.profraw", 
                      [[NSBundle mainBundle] bundleIdentifier]];
    NSArray *paths = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *documentsDirectory = [paths firstObject];
    NSString *filePath = [documentsDirectory stringByAppendingPathComponent:name];
    
    __llvm_profile_set_filename([filePath UTF8String]);
    NSLog(@"[Coverage] Output path: %@", filePath);
}

+ (void)dumpCoverageData {
    int result = __llvm_profile_write_file();
    if (result == 0) {
        NSLog(@"[Coverage] Data saved successfully");
    } else {
        NSLog(@"[Coverage] Failed to save data: %d", result);
    }
}

@end
```

### 3. 自动收集覆盖率数据

在 AppDelegate 中实现自动保存：

```objc
// AppDelegate.m
#import "CoverageCollector.h"

- (void)applicationDidEnterBackground:(UIApplication *)application {
    [CoverageCollector dumpCoverageData];
}

- (void)applicationWillTerminate:(UIApplication *)application {
    [CoverageCollector dumpCoverageData];
}
```

或 Swift 版本：

```swift
// AppDelegate.swift
func applicationDidEnterBackground(_ application: UIApplication) {
    CoverageCollector.dumpCoverageData()
}
```

## 覆盖率报告生成

### 1. 收集必要文件

```
project/
├── Demo.profraw          # 覆盖率数据文件
├── Demo.app              # App bundle
├── Demo.app.dSYM         # 符号表文件（用于解析）
├── coverage_report.sh    # 报告生成脚本
└── gitdiff/
    └── diffParser.rb     # 增量覆盖率解析脚本
```

### 2. 报告生成脚本

```bash
#!/bin/bash
# coverage_report.sh

PROFRAW_FILE=$1
OLD_COMMIT=$2

cleanup() {
    echo "清理临时文件..."
    [ -n "$PROFDATA_FILE" ] && rm -f "$PROFDATA_FILE"
    [ -n "$INFO_FILE" ] && rm -f "$INFO_FILE"
    rm -f gitdiff.diff
}
trap cleanup EXIT

# 1. 转换 profraw 为 profdata
echo "转换覆盖率数据..."
PROFDATA_FILE="${PROFRAW_FILE%.profraw}.profdata"
xcrun llvm-profdata merge -sparse "$PROFRAW_FILE" -o "$PROFDATA_FILE"

# 2. 查找 Mach-O 文件
echo "查找二进制文件..."
MACHO_FILE=$(find ./MachOFiles -type f -exec file {} + | grep 'Mach-O' | head -n1 | cut -d: -f1)
if [ -z "$MACHO_FILE" ]; then
    echo "错误: 未找到 Mach-O 文件"
    exit 1
fi
echo "找到二进制文件: $MACHO_FILE"

BIN_NAME=$(basename "$MACHO_FILE")
INFO_FILE="${BIN_NAME}.info"

# 3. 导出为 lcov 格式
echo "导出覆盖率数据..."
xcrun llvm-cov export "$MACHO_FILE" \
    -instr-profile="$PROFDATA_FILE" \
    -format=lcov > "$INFO_FILE"

# 4. 获取 Git diff（如果指定了旧 commit）
if [ -n "$OLD_COMMIT" ]; then
    echo "获取 Git diff..."
    CURRENT_COMMIT=$(git rev-parse --short=7 HEAD)
    git diff "$OLD_COMMIT" "$CURRENT_COMMIT" --unified=0 > gitdiff.diff
    
    # 5. 解析增量覆盖率
    echo "计算增量覆盖率..."
    ruby gitdiff/utils/diffParser.rb \
        --diff-file=gitdiff.diff \
        --coverage-info-file="$INFO_FILE"
    
    # 6. 生成增量报告
    genhtml -o "${BIN_NAME}_incremental_html" \
        ./"${BIN_NAME}_gather.info" \
        --ignore-errors category
    
    echo "增量报告已生成: ${BIN_NAME}_incremental_html/index.html"
fi

# 7. 生成全量报告
echo "生成全量报告..."
genhtml -o "${BIN_NAME}_full_html" \
    "$INFO_FILE" \
    --ignore-errors category

echo "全量报告已生成: ${BIN_NAME}_full_html/index.html"

# 8. 打开报告
open "${BIN_NAME}_full_html/index.html"
```

### 3. 使用方式

```bash
# 生成全量报告
sh coverage_report.sh Demo.profraw

# 生成增量报告（对比指定 commit）
sh coverage_report.sh Demo.profraw abc1234
```

## 上传到平台

```bash
# 上传覆盖率数据
curl -X POST http://your-platform/api/upload/coverage \
  -F "projectId=1" \
  -F "commitHash=$(git rev-parse HEAD)" \
  -F "branch=$(git branch --show-current)" \
  -F "platform=ios" \
  -F "file=@Demo.profraw" \
  -F "binary=@Demo.app" \
  -F "dsym=@Demo.app.dSYM.zip"
```

## 参考文档

- [Clang Source-based Code Coverage](https://clang.llvm.org/docs/SourceBasedCodeCoverage.html)
- [LLVM Sanitizer Coverage](https://clang.llvm.org/docs/SanitizerCoverage.html)
- [Apple Code Coverage](https://developer.apple.com/documentation/xcode/generating-code-coverage-metrics)
