//
//  CoverageUploader.h
//  覆盖率数据上传器
//
//  用于把 CoverageCollector 落盘的 .profraw 文件上传到 CoveragePlatform。
//  对应 Android 端的 CoverageUploader.kt，但走的是正确的接口：
//  POST /api/builds/:buildId/raw-coverage（服务端按 buildId 自动合并多次上传、计算增量覆盖率），
//  而不是 /api/upload/coverage（那个接口只接受已转换好的 LCOV/XML，原始 .profraw/.ec 会被直接拒绝）。
//
//  使用前提：buildId 需要提前在平台创建好（POST /api/builds，上传 Mach-O 二进制 + projectId +
//  commitHash + branch），commitHash/branch/gitDiff 都是创建 Build 时定的，上传 .profraw 这一步
//  不需要再传——这也是为什么这里的初始化参数比 Android 模板（CoverageUploader.kt）少：
//  Android 模板每次上传都要重新传 projectId/commitHash/branch，是因为它用错了接口。
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^CoverageUploadCompletion)(BOOL success, NSString * _Nullable message, NSString * _Nullable reportId);

@interface CoverageUploader : NSObject

/**
 * 初始化上传器（幂等，多次调用只生效一次）
 *
 * @param baseURL 平台服务地址，如 https://coverage-platform.internal
 * @param buildId 提前在平台创建好的 Build ID
 */
+ (void)initWithBaseURL:(NSString *)baseURL buildId:(NSString *)buildId;

/**
 * 是否已初始化
 */
+ (BOOL)isInitialized;

/**
 * 上传指定的 .profraw 文件
 *
 * @param filePath .profraw 文件路径
 * @param completion 上传结果回调，在主线程调用
 */
+ (void)uploadCoverageFile:(NSString *)filePath completion:(nullable CoverageUploadCompletion)completion;

/**
 * 上传 CoverageCollector 落盘的最新一份覆盖率文件（便捷方法）
 *
 * @param completion 上传结果回调，在主线程调用
 */
+ (void)uploadLatestCoverageFileWithCompletion:(nullable CoverageUploadCompletion)completion;

@end

NS_ASSUME_NONNULL_END
