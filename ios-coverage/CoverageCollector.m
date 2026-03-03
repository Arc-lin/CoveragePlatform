//
//  CoverageCollector.m
//  iOS Code Coverage Collector
//

#import "CoverageCollector.h"
#import <dlfcn.h>

// LLVM Profile 运行时函数声明
#ifndef PROFILE_INSTRPROFILING_H_
#define PROFILE_INSTRPROFILING_H_

extern int __llvm_profile_runtime;
void __llvm_profile_initialize_file(void);
const char *__llvm_profile_get_filename(void);
void __llvm_profile_set_filename(const char *);
int __llvm_profile_write_file(void);
int __llvm_profile_register_write_file_atexit(void);
const char *__llvm_profile_get_path_prefix(void);

#endif /* PROFILE_INSTRPROFILING_H_ */

// Sanitizer Coverage 回调函数
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
    // 可以在这里添加调试日志
    // NSLog(@"[Coverage] PC: %p, Function: %s", PC, info.dli_sname);
}

static NSString *s_coverageDirectory = nil;

@implementation CoverageCollector

+ (void)initializeCollector {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSString *coveragePath = [self coverageFilePath];
        if (coveragePath) {
            __llvm_profile_set_filename([coveragePath UTF8String]);
            NSLog(@"[Coverage] Initialized with output path: %@", coveragePath);
        }
    });
}

+ (BOOL)dumpCoverageData {
    int result = __llvm_profile_write_file();
    if (result == 0) {
        NSLog(@"[Coverage] Data saved successfully to: %@", [self coverageFilePath]);
        return YES;
    } else {
        NSLog(@"[Coverage] Failed to save data, error code: %d", result);
        return NO;
    }
}

+ (nullable NSString *)coverageFilePath {
    NSString *directory = [self coverageDirectory];
    NSString *bundleIdentifier = [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";
    NSString *timestamp = [self currentTimestamp];
    NSString *fileName = [NSString stringWithFormat:@"%@_%@.profraw", bundleIdentifier, timestamp];
    return [directory stringByAppendingPathComponent:fileName];
}

+ (NSArray<NSString *> *)allCoverageFiles {
    NSString *directory = [self coverageDirectory];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSError *error = nil;
    
    NSArray *files = [fileManager contentsOfDirectoryAtPath:directory error:&error];
    if (error) {
        NSLog(@"[Coverage] Error reading directory: %@", error);
        return @[];
    }
    
    NSMutableArray *coverageFiles = [NSMutableArray array];
    for (NSString *file in files) {
        if ([file hasSuffix:@".profraw"]) {
            [coverageFiles addObject:[directory stringByAppendingPathComponent:file]];
        }
    }
    
    return [coverageFiles copy];
}

+ (void)clearCoverageData {
    NSString *directory = [self coverageDirectory];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSError *error = nil;
    
    NSArray *files = [fileManager contentsOfDirectoryAtPath:directory error:&error];
    for (NSString *file in files) {
        if ([file hasSuffix:@".profraw"]) {
            NSString *filePath = [directory stringByAppendingPathComponent:file];
            [fileManager removeItemAtPath:filePath error:nil];
        }
    }
    
    NSLog(@"[Coverage] All coverage data cleared");
}

+ (void)setCoverageDirectory:(NSString *)directory {
    s_coverageDirectory = [directory copy];
    
    // 确保目录存在
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:directory]) {
        NSError *error = nil;
        [fileManager createDirectoryAtPath:directory
               withIntermediateDirectories:YES
                                attributes:nil
                                     error:&error];
        if (error) {
            NSLog(@"[Coverage] Failed to create directory: %@", error);
        }
    }
}

+ (NSString *)coverageDirectory {
    if (s_coverageDirectory) {
        return s_coverageDirectory;
    }
    
    // 默认使用 Document 目录下的 Coverage 子目录
    NSArray *paths = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *documentsDirectory = [paths firstObject];
    NSString *coverageDir = [documentsDirectory stringByAppendingPathComponent:@"Coverage"];
    
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:coverageDir]) {
        [fileManager createDirectoryAtPath:coverageDir
               withIntermediateDirectories:YES
                                attributes:nil
                                     error:nil];
    }
    
    return coverageDir;
}

+ (NSString *)currentTimestamp {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    [formatter setDateFormat:@"yyyyMMdd_HHmmss"];
    return [formatter stringFromDate:[NSDate date]];
}

@end
