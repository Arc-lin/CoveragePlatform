//
//  CoverageUploader.h
//  覆盖率数据上传器
//
//  用于把 CoverageCollector 落盘的 .profraw 文件上传到 CoveragePlatform。
//  走的是 POST /api/builds/:buildId/raw-coverage（服务端按 buildId 自动合并多次上传、计算增量
//  覆盖率），而不是 /api/upload/coverage（那个接口只接受已转换好的 LCOV/XML，原始 .profraw 会被
//  直接拒绝）。
//
//  buildId 不需要手动维护：初始化只需要传 baseURL + projectId，commitHash 会自动从 App Bundle
//  里的 CoverageInfo.plist（Xcode Build Phase 在编译时写入，见接入文档第 2.4 节）读取，首次上传时
//  自动调 GET /api/builds/resolve?projectId=&commitHash= 换成 buildId 并缓存。
//
//  这要求 CI/本机编译时已经调用过 POST /api/builds（用同一个 commitHash 上传过编译产物），
//  否则 resolve 会 404——这是预期行为，说明这次构建还没有可用于解析覆盖率数据的二进制。
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^CoverageUploadCompletion)(BOOL success, NSString * _Nullable message, NSString * _Nullable reportId);

@interface CoverageUploader : NSObject

/**
 * 初始化上传器（幂等，多次调用只生效一次）
 *
 * @param baseURL 平台服务地址，如 https://coverage-platform.internal
 * @param projectId 提前在平台创建好的项目 ID
 */
+ (void)initWithBaseURL:(NSString *)baseURL projectId:(NSString *)projectId;

/**
 * 是否已初始化（不代表已经拿到 buildId——buildId 是首次上传时才异步解析的）
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
