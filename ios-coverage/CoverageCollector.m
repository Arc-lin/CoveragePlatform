//
//  CoverageCollector.m
//  iOS Code Coverage Collector
//

#import "CoverageCollector.h"

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

static NSString *s_coverageDirectory = nil;
static NSString *s_coverageFilePath = nil;

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
    // 固定路径：第一次调用时算好就缓存住，后续调用（dumpCoverageData 的日志、CoverageUploader
    // 取最新文件）必须拿到同一个路径，否则会拿到一个从未被 __llvm_profile_write_file 写过的新路径
    if (s_coverageFilePath) {
        return s_coverageFilePath;
    }
    NSString *directory = [self coverageDirectory];
    NSString *bundleIdentifier = [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";
    NSString *timestamp = [self currentTimestamp];
    NSString *fileName = [NSString stringWithFormat:@"%@_%@.profraw", bundleIdentifier, timestamp];
    s_coverageFilePath = [directory stringByAppendingPathComponent:fileName];
    return s_coverageFilePath;
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
    s_coverageFilePath = nil; // 目录变了，让 coverageFilePath 下次调用时按新目录重新计算

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
