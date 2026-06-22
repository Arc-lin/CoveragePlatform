//
//  CoverageUploader.m
//  覆盖率数据上传器
//

#import "CoverageUploader.h"
#import "CoverageCollector.h"

static NSString *s_baseURL = nil;
static NSString *s_buildId = nil;

@implementation CoverageUploader

+ (void)initWithBaseURL:(NSString *)baseURL buildId:(NSString *)buildId {
    if (s_baseURL != nil) {
        return; // 幂等，已初始化过就不再重复设置
    }
    // 去掉末尾的 "/"，避免拼接出 "//api/..."
    if ([baseURL hasSuffix:@"/"]) {
        s_baseURL = [baseURL substringToIndex:baseURL.length - 1];
    } else {
        s_baseURL = [baseURL copy];
    }
    s_buildId = [buildId copy];
}

+ (BOOL)isInitialized {
    return s_baseURL != nil && s_buildId != nil;
}

+ (void)uploadLatestCoverageFileWithCompletion:(CoverageUploadCompletion)completion {
    NSString *filePath = [CoverageCollector coverageFilePath];
    if (filePath == nil || ![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
        if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, @"No coverage file to upload", nil);
            });
        }
        return;
    }
    [self uploadCoverageFile:filePath completion:completion];
}

+ (void)uploadCoverageFile:(NSString *)filePath completion:(CoverageUploadCompletion)completion {
    if (![self isInitialized]) {
        if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, @"CoverageUploader not initialized. Call +initWithBaseURL:buildId: first.", nil);
            });
        }
        return;
    }

    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:filePath]) {
        if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, [NSString stringWithFormat:@"Coverage file not found: %@", filePath], nil);
            });
        }
        return;
    }

    NSData *fileData = [NSData dataWithContentsOfFile:filePath];
    if (fileData == nil) {
        if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, [NSString stringWithFormat:@"Failed to read coverage file: %@", filePath], nil);
            });
        }
        return;
    }

    NSString *fileName = [filePath lastPathComponent];
    NSString *urlString = [NSString stringWithFormat:@"%@/api/builds/%@/raw-coverage", s_baseURL, s_buildId];
    NSURL *url = [NSURL URLWithString:urlString];

    NSString *boundary = [[NSUUID UUID] UUIDString];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 60;
    [request setValue:[NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary]
   forHTTPHeaderField:@"Content-Type"];

    NSMutableData *body = [NSMutableData data];
    [body appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
    [body appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"file\"; filename=\"%@\"\r\n", fileName] dataUsingEncoding:NSUTF8StringEncoding]];
    [body appendData:[@"Content-Type: application/octet-stream\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding]];
    [body appendData:fileData];
    [body appendData:[[NSString stringWithFormat:@"\r\n--%@--\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
    request.HTTPBody = body;

    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(NSData * _Nullable data, NSURLResponse * _Nullable response, NSError * _Nullable error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self handleResponse:response data:data error:error completion:completion];
            });
        }];
    [task resume];
}

+ (void)handleResponse:(NSURLResponse *)response
                   data:(NSData *)data
                  error:(NSError *)error
             completion:(CoverageUploadCompletion)completion {
    if (error != nil) {
        if (completion) {
            completion(NO, [NSString stringWithFormat:@"Network error: %@", error.localizedDescription], nil);
        }
        return;
    }

    NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
    NSInteger statusCode = httpResponse.statusCode;

    NSDictionary *json = nil;
    if (data.length > 0) {
        json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    }

    if (statusCode < 200 || statusCode >= 300) {
        NSString *message = [json[@"message"] isKindOfClass:[NSString class]]
            ? json[@"message"]
            : [NSString stringWithFormat:@"Upload failed: HTTP %ld", (long)statusCode];
        if (completion) {
            completion(NO, message, nil);
        }
        return;
    }

    if (json == nil) {
        // HTTP 2xx 但响应体不是合法 JSON（如 CDN 错误页），视为上传失败
        if (completion) {
            completion(NO, @"Server returned non-JSON response", nil);
        }
        return;
    }

    NSString *message = [json[@"message"] isKindOfClass:[NSString class]] ? json[@"message"] : @"Upload successful";
    NSDictionary *resultData = [json[@"data"] isKindOfClass:[NSDictionary class]] ? json[@"data"] : nil;
    NSString *reportId = [resultData[@"reportId"] isKindOfClass:[NSString class]] ? resultData[@"reportId"] : nil;

    if (completion) {
        completion(YES, message, reportId);
    }
}

@end
