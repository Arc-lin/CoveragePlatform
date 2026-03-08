#!/usr/bin/env node

/**
 * 生成假数据脚本（为所有报告生成文件覆盖率）
 */

const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb://localhost:27017/coverage';

// 假数据：项目
const projects = [
  { name: 'iOS 商城 App', platform: 'ios', repositoryUrl: 'https://github.com/example/ios-shop-app' },
  { name: 'Android 商城 App', platform: 'android', repositoryUrl: 'https://github.com/example/android-shop-app' },
  { name: 'Python 后端服务', platform: 'python', repositoryUrl: 'https://github.com/example/python-backend' },
  { name: 'iOS 支付 SDK', platform: 'ios', repositoryUrl: 'https://github.com/example/ios-payment-sdk' },
  { name: 'Android 推送 SDK', platform: 'android', repositoryUrl: 'https://github.com/example/android-push-sdk' }
];

// 假数据：覆盖率报告
const coverageReports = {
  'ios-shop': [
    { commitHash: 'a1b2c3d4', branch: 'main', lineCoverage: 85.5, functionCoverage: 92.3, branchCoverage: 78.2 },
    { commitHash: 'b2c3d4e5', branch: 'main', lineCoverage: 86.2, functionCoverage: 93.1, branchCoverage: 79.5 },
    { commitHash: 'c3d4e5f6', branch: 'main', lineCoverage: 84.8, functionCoverage: 91.5, branchCoverage: 77.8 },
    { commitHash: 'd4e5f6g7', branch: 'develop', lineCoverage: 87.1, functionCoverage: 94.2, branchCoverage: 80.3 },
    { commitHash: 'e5f6g7h8', branch: 'main', lineCoverage: 88.3, functionCoverage: 95.0, branchCoverage: 81.7 }
  ],
  'android-shop': [
    { commitHash: 'f6g7h8i9', branch: 'main', lineCoverage: 78.2, functionCoverage: 85.6, branchCoverage: 72.1 },
    { commitHash: 'g7h8i9j0', branch: 'main', lineCoverage: 79.5, functionCoverage: 86.3, branchCoverage: 73.4 },
    { commitHash: 'h8i9j0k1', branch: 'develop', lineCoverage: 80.1, functionCoverage: 87.2, branchCoverage: 74.8 },
    { commitHash: 'i9j0k1l2', branch: 'main', lineCoverage: 81.3, functionCoverage: 88.5, branchCoverage: 75.9 }
  ],
  'python-backend': [
    { commitHash: 'j0k1l2m3', branch: 'main', lineCoverage: 92.5, functionCoverage: 96.8, branchCoverage: 88.3 },
    { commitHash: 'k1l2m3n4', branch: 'main', lineCoverage: 93.2, functionCoverage: 97.1, branchCoverage: 89.5 },
    { commitHash: 'l2m3n4o5', branch: 'develop', lineCoverage: 91.8, functionCoverage: 96.2, branchCoverage: 87.9 },
    { commitHash: 'm3n4o5p6', branch: 'main', lineCoverage: 94.1, functionCoverage: 97.8, branchCoverage: 90.2 },
    { commitHash: 'n4o5p6q7', branch: 'main', lineCoverage: 95.3, functionCoverage: 98.5, branchCoverage: 91.6 },
    { commitHash: 'o5p6q7r8', branch: 'main', lineCoverage: 96.0, functionCoverage: 99.0, branchCoverage: 92.8 }
  ],
  'ios-payment': [
    { commitHash: 'p6q7r8s9', branch: 'main', lineCoverage: 72.3, functionCoverage: 80.5, branchCoverage: 65.8 },
    { commitHash: 'q7r8s9t0', branch: 'main', lineCoverage: 73.8, functionCoverage: 81.2, branchCoverage: 67.1 }
  ],
  'android-push': [
    { commitHash: 'r8s9t0u1', branch: 'main', lineCoverage: 68.5, functionCoverage: 75.3, branchCoverage: 62.1 },
    { commitHash: 's9t0u1v2', branch: 'develop', lineCoverage: 69.2, functionCoverage: 76.8, branchCoverage: 63.5 },
    { commitHash: 't0u1v2w3', branch: 'main', lineCoverage: 70.5, functionCoverage: 77.9, branchCoverage: 64.8 }
  ]
};

// 文件模板
const fileTemplates = {
  ios: [
    { filePath: 'src/viewcontrollers/HomeViewController.swift', totalLines: 256 },
    { filePath: 'src/viewcontrollers/ProductListViewController.swift', totalLines: 189 },
    { filePath: 'src/services/APIClient.swift', totalLines: 312 },
    { filePath: 'src/utils/Extensions.swift', totalLines: 145 },
    { filePath: 'src/models/Product.swift', totalLines: 68 },
    { filePath: 'src/viewmodels/CartViewModel.swift', totalLines: 203 }
  ],
  android: [
    { filePath: 'com/example/shop/MainActivity.java', totalLines: 178 },
    { filePath: 'com/example/shop/api/ApiClient.java', totalLines: 245 },
    { filePath: 'com/example/shop/ui/ProductAdapter.java', totalLines: 156 },
    { filePath: 'com/example/shop/database/ShopDatabase.java', totalLines: 98 },
    { filePath: 'com/example/shop/util/StringUtils.java', totalLines: 134 },
    { filePath: 'com/example/shop/viewmodel/ProductViewModel.java', totalLines: 187 }
  ],
  python: [
    { filePath: 'app/api/views.py', totalLines: 423 },
    { filePath: 'app/api/controllers.py', totalLines: 567 },
    { filePath: 'app/models/user.py', totalLines: 145 },
    { filePath: 'app/utils/helpers.py', totalLines: 234 },
    { filePath: 'tests/test_api.py', totalLines: 312 },
    { filePath: 'app/services/payment.py', totalLines: 289 }
  ]
};

// 生成行级数据
function generateLines(totalLines, coverage) {
  const lines = [];
  for (let i = 1; i <= totalLines; i++) {
    const isCovered = Math.random() * 100 < coverage;
    lines.push({
      lineNumber: i,
      isCovered,
      coveredInstructions: isCovered ? Math.floor(Math.random() * 5) + 1 : 0,
      missedInstructions: isCovered ? 0 : Math.floor(Math.random() * 3) + 1
    });
  }
  return lines;
}

// Mongoose 模型
const Project = mongoose.model('Project', new mongoose.Schema({
  name: String,
  platform: String,
  repositoryUrl: String,
  createdAt: Date,
  updatedAt: Date
}, { collection: 'projects' }));

const CoverageReport = mongoose.model('CoverageReport', new mongoose.Schema({
  projectId: mongoose.Schema.Types.ObjectId,
  commitHash: String,
  branch: String,
  lineCoverage: Number,
  functionCoverage: Number,
  branchCoverage: Number,
  incrementalCoverage: Number,
  gitDiff: String,
  reportPath: String,
  buildId: mongoose.Schema.Types.ObjectId,
  source: String,
  createdAt: Date
}, { collection: 'coveragereports' }));

const FileCoverage = mongoose.model('FileCoverage', new mongoose.Schema({
  reportId: mongoose.Schema.Types.ObjectId,
  filePath: String,
  lineCoverage: Number,
  totalLines: Number,
  coveredLines: Number,
  lines: Array,
  createdAt: Date
}, { collection: 'filecoverages' }));

async function main() {
  console.log('🚀 开始生成假数据...\n');
  
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ 连接到 MongoDB\n');
    
    // 清空现有数据
    console.log('🗑️  清空现有数据...');
    await Project.deleteMany({});
    await CoverageReport.deleteMany({});
    await FileCoverage.deleteMany({});
    console.log('✅ 清空完成\n');
    
    // 1. 创建项目
    console.log('📁 创建项目...');
    const createdProjects = [];
    
    for (const projectData of projects) {
      const project = new Project({
        ...projectData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await project.save();
      console.log(`  ✅ ${project.name} (${project.platform})`);
      createdProjects.push(project);
    }
    
    console.log(`\n✅ 共创建 ${createdProjects.length} 个项目\n`);
    
    // 2. 创建覆盖率报告
    console.log('📊 创建覆盖率报告...');
    const projectKeys = ['ios-shop', 'android-shop', 'python-backend', 'ios-payment', 'android-push'];
    const createdReports = [];
    
    for (let i = 0; i < createdProjects.length; i++) {
      const project = createdProjects[i];
      const key = projectKeys[i];
      const reports = coverageReports[key];
      
      console.log(`\n  项目：${project.name}`);
      
      if (reports) {
        for (const reportData of reports) {
          const report = new CoverageReport({
            projectId: project._id,
            ...reportData,
            source: 'manual',
            createdAt: new Date()
          });
          await report.save();
          console.log(`    ✅ ${report.commitHash} - 行覆盖率：${report.lineCoverage}%`);
          createdReports.push({ project, report });
        }
      }
    }
    
    console.log(`\n✅ 共创建 ${createdReports.length} 个覆盖率报告\n`);
    
    // 3. 为所有报告创建文件覆盖率
    console.log('📄 创建文件覆盖率（所有报告）...');
    
    for (const { project, report } of createdReports) {
      const templates = fileTemplates[project.platform] || fileTemplates.ios;
      
      for (const fileTemplate of templates) {
        const lines = generateLines(fileTemplate.totalLines, report.lineCoverage);
        const coveredLines = lines.filter(l => l.isCovered).length;
        
        const fileCoverage = new FileCoverage({
          reportId: report._id,
          filePath: fileTemplate.filePath,
          lineCoverage: report.lineCoverage,
          totalLines: fileTemplate.totalLines,
          coveredLines,
          lines,
          createdAt: new Date()
        });
        await fileCoverage.save();
      }
      console.log(`  ✅ 为报告 ${report.commitHash} 添加 ${templates.length} 个文件`);
    }
    
    console.log(`\n🎉 假数据生成完成！`);
    console.log('\n📈 数据摘要:');
    console.log(`   - 项目数量：${createdProjects.length}`);
    console.log(`   - 覆盖率报告数量：${createdReports.length}`);
    console.log(`   - 文件覆盖率记录：${createdReports.length * 6}`);
    console.log('\n🌐 访问地址：http://192.168.0.113:3000');
    
  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 断开 MongoDB 连接');
  }
}

main().catch(console.error);
