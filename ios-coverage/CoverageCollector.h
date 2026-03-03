//
//  CoverageCollector.h
//  iOS Code Coverage Collector
//
//  用于收集 iOS 应用的代码覆盖率数据
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface CoverageCollector : NSObject

/**
 * 初始化覆盖率收集器，设置输出文件路径
 * 建议在 Application 启动时调用
 */
+ (void)initializeCollector;

/**
 * 手动触发覆盖率数据保存
 * 返回是否保存成功
 */
+ (BOOL)dumpCoverageData;

/**
 * 获取覆盖率数据文件路径
 */
+ (nullable NSString *)coverageFilePath;

/**
 * 获取所有历史覆盖率文件
 */
+ (NSArray<NSString *> *)allCoverageFiles;

/**
 * 清除所有覆盖率数据
 */
+ (void)clearCoverageData;

/**
 * 设置覆盖率数据输出目录（可选，默认为 Document 目录）
 */
+ (void)setCoverageDirectory:(NSString *)directory;

@end

NS_ASSUME_NONNULL_END
