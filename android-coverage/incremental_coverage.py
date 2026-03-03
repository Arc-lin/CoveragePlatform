#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Android 增量覆盖率分析工具

功能：
1. 解析 JaCoCo XML 报告
2. 解析 Git Diff 文件
3. 计算增量代码覆盖率
4. 生成增量覆盖率报告

使用方法：
    python incremental_coverage.py \
        --jacoco-report app/build/reports/jacoco/merged/report.xml \
        --diff-file diff.patch \
        --output incremental-report.json
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set
from xml.etree import ElementTree as ET


@dataclass
class FileChange:
    """Git 文件变更信息"""
    file_path: str
    changed_lines: List[int]
    
    def to_dict(self):
        return asdict(self)


@dataclass
class LineCoverage:
    """单行覆盖率信息"""
    line_number: int
    instruction_missed: int
    instruction_covered: int
    branch_missed: int
    branch_covered: int
    
    @property
    def is_covered(self) -> bool:
        return self.instruction_covered > 0
    
    @property
    def coverage_percent(self) -> float:
        total = self.instruction_missed + self.instruction_covered
        if total == 0:
            return 100.0
        return (self.instruction_covered / total) * 100


@dataclass
class FileCoverage:
    """文件覆盖率信息"""
    file_path: str
    lines: Dict[int, LineCoverage]
    
    def get_line(self, line_number: int) -> Optional[LineCoverage]:
        return self.lines.get(line_number)


@dataclass
class IncrementalCoverageResult:
    """增量覆盖率结果"""
    file_path: str
    total_changed_lines: int
    covered_lines: int
    missed_lines: int
    line_coverage_percent: float
    changed_lines_detail: List[Dict]
    
    def to_dict(self):
        return asdict(self)


def parse_diff(diff_content: str, source_extensions: List[str] = None) -> List[FileChange]:
    """
    解析 Git Diff 内容
    
    Args:
        diff_content: Git diff 文本内容
        source_extensions: 需要统计的文件扩展名列表，如 ['.java', '.kt']
    
    Returns:
        文件变更列表
    """
    if source_extensions is None:
        source_extensions = ['.java', '.kt']
    
    file_changes = []
    current_file = None
    current_lines = []
    is_target_file = False
    
    for line in diff_content.split('\n'):
        # 识别文件变更开始
        if line.startswith('diff --git'):
            # 保存上一个文件的信息
            if current_file and current_lines:
                file_changes.append(FileChange(
                    file_path=current_file,
                    changed_lines=sorted(set(current_lines))
                ))
            
            current_file = None
            current_lines = []
            is_target_file = False
            
            # 检查文件扩展名
            for ext in source_extensions:
                if ext in line:
                    is_target_file = True
                    break
        
        # 提取文件路径
        if is_target_file and line.startswith('+++ b/'):
            current_file = line[6:].strip()  # 去掉 "+++ b/" 前缀
        
        # 解析 @@ 行号信息
        if is_target_file and line.startswith('@@'):
            # 格式: @@ -oldStart,oldCount +newStart,newCount @@
            match = re.search(r'\+\d+(?:,\d+)?', line)
            if match:
                line_info = match.group(0)[1:]  # 去掉 "+"
                if ',' in line_info:
                    start_line = int(line_info.split(',')[0])
                    count = int(line_info.split(',')[1])
                else:
                    start_line = int(line_info)
                    count = 1
                
                for i in range(count):
                    current_lines.append(start_line + i)
        
        # 解析 + 开头的行（新增代码）
        if is_target_file and line.startswith('+') and not line.startswith('+++'):
            # 这里需要结合 @@ 信息，暂时由 @@ 解析处理
            pass
    
    # 保存最后一个文件
    if current_file and current_lines:
        file_changes.append(FileChange(
            file_path=current_file,
            changed_lines=sorted(set(current_lines))
        ))
    
    return file_changes


def parse_jacoco_report(xml_path: str) -> Dict[str, FileCoverage]:
    """
    解析 JaCoCo XML 报告
    
    Args:
        xml_path: JaCoCo XML 报告路径
    
    Returns:
        文件路径 -> 文件覆盖率信息的字典
    """
    file_coverages = {}
    
    tree = ET.parse(xml_path)
    root = tree.getroot()
    
    # JaCoCo XML 结构: report > package > sourcefile > line
    for package in root.findall('.//package'):
        package_name = package.get('name', '').replace('/', '.')
        
        for sourcefile in package.findall('sourcefile'):
            file_name = sourcefile.get('name', '')
            file_path = f"{package_name}/{file_name}"
            
            lines = {}
            for line in sourcefile.findall('line'):
                line_num = int(line.get('nr', 0))
                lines[line_num] = LineCoverage(
                    line_number=line_num,
                    instruction_missed=int(line.get('mi', 0)),
                    instruction_covered=int(line.get('ci', 0)),
                    branch_missed=int(line.get('mb', 0)),
                    branch_covered=int(line.get('cb', 0))
                )
            
            file_coverages[file_path] = FileCoverage(
                file_path=file_path,
                lines=lines
            )
    
    return file_coverages


def calculate_incremental_coverage(
    file_changes: List[FileChange],
    file_coverages: Dict[str, FileCoverage]
) -> List[IncrementalCoverageResult]:
    """
    计算增量代码覆盖率
    
    Args:
        file_changes: Git 文件变更列表
        file_coverages: JaCoCo 覆盖率数据
    
    Returns:
        增量覆盖率结果列表
    """
    results = []
    
    for change in file_changes:
        # 在覆盖率数据中查找对应文件
        file_coverage = None
        for path, coverage in file_coverages.items():
            if change.file_path in path or path in change.file_path:
                file_coverage = coverage
                break
        
        if not file_coverage:
            # 文件未被覆盖率统计（可能是新文件或测试未覆盖）
            results.append(IncrementalCoverageResult(
                file_path=change.file_path,
                total_changed_lines=len(change.changed_lines),
                covered_lines=0,
                missed_lines=len(change.changed_lines),
                line_coverage_percent=0.0,
                changed_lines_detail=[
                    {"line": line, "covered": False, "missed_instructions": 0}
                    for line in change.changed_lines
                ]
            ))
            continue
        
        # 计算变更行的覆盖率
        covered_lines = 0
        missed_lines = 0
        lines_detail = []
        
        for line_num in change.changed_lines:
            line_coverage = file_coverage.get_line(line_num)
            
            if line_coverage:
                if line_coverage.is_covered:
                    covered_lines += 1
                    lines_detail.append({
                        "line": line_num,
                        "covered": True,
                        "instruction_covered": line_coverage.instruction_covered,
                        "instruction_missed": line_coverage.instruction_missed
                    })
                else:
                    missed_lines += 1
                    lines_detail.append({
                        "line": line_num,
                        "covered": False,
                        "instruction_covered": 0,
                        "instruction_missed": line_coverage.instruction_missed
                    })
            else:
                # 行号未在覆盖率报告中（可能是空行、注释等）
                lines_detail.append({
                    "line": line_num,
                    "covered": None,
                    "note": "Not instrumented (possibly empty line or comment)"
                })
        
        total = covered_lines + missed_lines
        coverage_percent = (covered_lines / total * 100) if total > 0 else 100.0
        
        results.append(IncrementalCoverageResult(
            file_path=change.file_path,
            total_changed_lines=total,
            covered_lines=covered_lines,
            missed_lines=missed_lines,
            line_coverage_percent=round(coverage_percent, 2),
            changed_lines_detail=lines_detail
        ))
    
    return results


def generate_report(
    results: List[IncrementalCoverageResult],
    output_path: str,
    old_commit: str = None,
    new_commit: str = None
):
    """
    生成增量覆盖率报告
    
    Args:
        results: 覆盖率结果列表
        output_path: 输出文件路径
        old_commit: 旧 commit hash
        new_commit: 新 commit hash
    """
    total_changed = sum(r.total_changed_lines for r in results)
    total_covered = sum(r.covered_lines for r in results)
    total_missed = sum(r.missed_lines for r in results)
    
    overall_coverage = (total_covered / total_changed * 100) if total_changed > 0 else 0.0
    
    report = {
        "summary": {
            "old_commit": old_commit,
            "new_commit": new_commit,
            "total_files": len(results),
            "total_changed_lines": total_changed,
            "total_covered_lines": total_covered,
            "total_missed_lines": total_missed,
            "overall_coverage_percent": round(overall_coverage, 2),
            "status": "PASS" if overall_coverage >= 80 else "FAIL"
        },
        "files": [r.to_dict() for r in results],
        "generated_at": str(Path().stat().st_mtime)
    }
    
    # 写入 JSON 文件
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    return report


def print_summary(report: dict):
    """打印覆盖率摘要"""
    summary = report['summary']
    
    print("\n" + "="*60)
    print("增量代码覆盖率报告")
    print("="*60)
    print(f"Commit Range: {summary.get('old_commit', 'N/A')} -> {summary.get('new_commit', 'N/A')}")
    print(f"总文件数: {summary['total_files']}")
    print(f"变更代码行数: {summary['total_changed_lines']}")
    print(f"已覆盖行数: {summary['total_covered_lines']}")
    print(f"未覆盖行数: {summary['total_missed_lines']}")
    print(f"覆盖率: {summary['overall_coverage_percent']}%")
    print(f"状态: {summary['status']}")
    print("="*60)
    
    # 打印文件详情
    print("\n文件详情:")
    for file_report in report['files'][:10]:  # 只显示前10个文件
        status_icon = "✓" if file_report['line_coverage_percent'] >= 80 else "✗"
        print(f"  {status_icon} {file_report['file_path']}: {file_report['line_coverage_percent']}% "
              f"({file_report['covered_lines']}/{file_report['total_changed_lines']})")
    
    if len(report['files']) > 10:
        print(f"  ... 还有 {len(report['files']) - 10} 个文件")


def main():
    parser = argparse.ArgumentParser(
        description='Android 增量代码覆盖率分析工具'
    )
    parser.add_argument(
        '--jacoco-report', '-j',
        required=True,
        help='JaCoCo XML 报告路径'
    )
    parser.add_argument(
        '--diff-file', '-d',
        required=True,
        help='Git diff 文件路径'
    )
    parser.add_argument(
        '--output', '-o',
        default='incremental-coverage-report.json',
        help='输出报告路径 (默认: incremental-coverage-report.json)'
    )
    parser.add_argument(
        '--old-commit',
        help='旧 commit hash'
    )
    parser.add_argument(
        '--new-commit',
        help='新 commit hash'
    )
    parser.add_argument(
        '--extensions', '-e',
        nargs='+',
        default=['.java', '.kt'],
        help='要统计的文件扩展名 (默认: .java .kt)'
    )
    
    args = parser.parse_args()
    
    # 检查文件是否存在
    if not Path(args.jacoco_report).exists():
        print(f"错误: JaCoCo 报告文件不存在: {args.jacoco_report}")
        sys.exit(1)
    
    if not Path(args.diff_file).exists():
        print(f"错误: Diff 文件不存在: {args.diff_file}")
        sys.exit(1)
    
    print("正在解析 Git diff...")
    with open(args.diff_file, 'r', encoding='utf-8') as f:
        diff_content = f.read()
    file_changes = parse_diff(diff_content, args.extensions)
    print(f"发现 {len(file_changes)} 个变更文件")
    
    print("正在解析 JaCoCo 报告...")
    file_coverages = parse_jacoco_report(args.jacoco_report)
    print(f"覆盖率数据包含 {len(file_coverages)} 个文件")
    
    print("正在计算增量覆盖率...")
    results = calculate_incremental_coverage(file_changes, file_coverages)
    
    print("正在生成报告...")
    report = generate_report(
        results,
        args.output,
        args.old_commit,
        args.new_commit
    )
    
    print_summary(report)
    print(f"\n详细报告已保存至: {args.output}")


if __name__ == '__main__':
    main()
