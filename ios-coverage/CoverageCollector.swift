//
//  CoverageCollector.swift
//  iOS Code Coverage Collector (Swift 版本)
//

import Foundation

/// iOS 代码覆盖率收集器
public class CoverageCollector {
    
    // MARK: - Properties
    
    private static var coverageDirectory: URL?
    
    // LLVM Profile 函数声明
    private static let llvmProfileWriteFile: @convention(c) () -> Int32 = {
        let handle = dlopen(nil, RTLD_NOW)
        let sym = dlsym(handle, "__llvm_profile_write_file")
        return unsafeBitCast(sym, to: (@convention(c) () -> Int32).self)
    }()
    
    private static let llvmProfileSetFilename: @convention(c) (UnsafePointer<CChar>) -> Void = {
        let handle = dlopen(nil, RTLD_NOW)
        let sym = dlsym(handle, "__llvm_profile_set_filename")
        return unsafeBitCast(sym, to: (@convention(c) (UnsafePointer<CChar>) -> Void).self)
    }()
    
    // MARK: - Public Methods
    
    /// 初始化覆盖率收集器
    public static func initialize() {
        DispatchQueue.once {
            if let path = coverageFilePath()?.path {
                llvmProfileSetFilename(path)
                print("[Coverage] Initialized with output path: \(path)")
            }
        }
    }
    
    /// 保存覆盖率数据
    @discardableResult
    public static func dumpCoverageData() -> Bool {
        let result = llvmProfileWriteFile()
        if result == 0 {
            print("[Coverage] Data saved successfully")
            return true
        } else {
            print("[Coverage] Failed to save data, error code: \(result)")
            return false
        }
    }
    
    /// 获取覆盖率文件路径
    public static func coverageFilePath() -> URL? {
        let directory = coverageDirectory ?? defaultCoverageDirectory()
        let bundleIdentifier = Bundle.main.bundleIdentifier ?? "unknown"
        let timestamp = currentTimestamp()
        let fileName = "\(bundleIdentifier)_\(timestamp).profraw"
        return directory.appendingPathComponent(fileName)
    }
    
    /// 获取所有覆盖率文件
    public static func allCoverageFiles() -> [URL] {
        let directory = coverageDirectory ?? defaultCoverageDirectory()
        
        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )
            return files.filter { $0.pathExtension == "profraw" }
        } catch {
            print("[Coverage] Error reading directory: \(error)")
            return []
        }
    }
    
    /// 清除所有覆盖率数据
    public static func clearCoverageData() {
        let files = allCoverageFiles()
        for file in files {
            try? FileManager.default.removeItem(at: file)
        }
        print("[Coverage] All coverage data cleared")
    }
    
    /// 设置覆盖率输出目录
    public static func setCoverageDirectory(_ directory: URL) {
        coverageDirectory = directory
        
        // 确保目录存在
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
    }
    
    // MARK: - Private Methods
    
    private static func defaultCoverageDirectory() -> URL {
        let documentsPath = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first!
        
        let coveragePath = documentsPath.appendingPathComponent("Coverage")
        
        try? FileManager.default.createDirectory(
            at: coveragePath,
            withIntermediateDirectories: true
        )
        
        return coveragePath
    }
    
    private static func currentTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter.string(from: Date())
    }
}

// MARK: - DispatchQueue Extension

extension DispatchQueue {
    private static var _onceTracker = [String]()
    
    public class func once(file: String = #file, function: String = #function, line: Int = #line, block: () -> Void) {
        let token = file + ":" + function + ":" + String(line)
        once(token: token, block: block)
    }
    
    public class func once(token: String, block: () -> Void) {
        objc_sync_enter(self)
        defer { objc_sync_exit(self) }
        
        if _onceTracker.contains(token) {
            return
        }
        
        _onceTracker.append(token)
        block()
    }
}

// MARK: - Usage in AppDelegate

/*
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    
    func application(_ application: UIApplication, 
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 初始化覆盖率收集器
        CoverageCollector.initialize()
        return true
    }
    
    func applicationDidEnterBackground(_ application: UIApplication) {
        // App 进入后台时保存覆盖率数据
        CoverageCollector.dumpCoverageData()
    }
    
    func applicationWillTerminate(_ application: UIApplication) {
        // App 即将终止时保存覆盖率数据
        CoverageCollector.dumpCoverageData()
    }
}
*/
