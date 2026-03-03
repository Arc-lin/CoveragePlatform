#!/bin/bash
#
# iOS 代码覆盖率报告生成脚本
# 
# 使用方法:
#   sh coverage_report.sh <profraw文件> [旧commit]
#
# 示例:
#   sh coverage_report.sh Demo.profraw
#   sh coverage_report.sh Demo.profraw abc1234
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 清理函数
cleanup() {
    print_info "清理临时文件..."
    [ -n "$profdata_path" ] && rm -f "$profdata_path"
    [ -n "$binname" ] && rm -f "${binname}.info"
    [ -n "$binname" ] && rm -f "${binname}_gather.info"
    rm -f gitdiff.diff
    print_info "清理完成"
}

trap cleanup EXIT

# 检查参数
if [ $# -lt 1 ]; then
    echo "用法: $0 <profraw文件> [oldCommit]"
    echo ""
    echo "参数说明:"
    echo "  profraw文件  - LLVM Profile 数据文件路径"
    echo "  oldCommit    - 可选，对比的 Git commit hash"
    echo ""
    echo "示例:"
    echo "  $0 Demo.profraw"
    echo "  $0 Demo.profraw abc1234"
    exit 1
fi

profraw_path=$1
profbase=${profraw_path%.profraw}
profdata_path=${profbase}.profdata

print_info "Profraw 文件: $profraw_path"
print_info "Profdata 文件: $profdata_path"

# 检查 profraw 文件
if [ ! -f "$profraw_path" ]; then
    print_error "Profraw 文件不存在: $profraw_path"
    exit 1
fi

# 获取 commit 信息
if [ $# -ge 2 ]; then
    oldCommit=$2
    print_info "对比 Commit: $oldCommit"
else
    # 默认对比上一个 commit
    oldCommit=$(git rev-parse --short=7 HEAD~1 2>/dev/null || echo "")
    if [ -n "$oldCommit" ]; then
        print_info "使用默认对比 Commit: $oldCommit"
    fi
fi

currentCommit=$(git rev-parse --short=7 HEAD 2>/dev/null || echo "unknown")
print_info "当前 Commit: $currentCommit"

# 1. 生成 git diff（如果需要增量分析）
if [ -n "$oldCommit" ]; then
    print_info "生成 Git diff..."
    git diff $oldCommit $currentCommit --unified=0 > gitdiff.diff 2>/dev/null || {
        print_warn "无法生成 Git diff，可能是非 Git 仓库或 commit 不存在"
        rm -f gitdiff.diff
        oldCommit=""
    }
fi

# 2. 合并 profraw 为 profdata
print_info "转换 profraw 为 profdata..."
xcrun llvm-profdata merge -sparse "$profraw_path" -o "$profdata_path"

# 3. 查找 Mach-O 文件
print_info "查找 Mach-O 二进制文件..."

# 尝试多个可能的目录
search_dirs=(
    "./MachOFiles"
    "./Products"
    "./Build/Products/Debug-iphonesimulator"
    "./Build/Products/Debug-iphoneos"
    "${CONFIGURATION_BUILD_DIR:-}"
)

macho_bin=""
for dir in "${search_dirs[@]}"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
        macho_bin=$(find "$dir" -type f -exec file {} + 2>/dev/null | \
                    grep -E 'Mach-O.*executable' | head -n1 | cut -d: -f1)
        if [ -n "$macho_bin" ]; then
            print_info "在 $dir 中找到二进制文件"
            break
        fi
    fi
done

if [ -z "$macho_bin" ]; then
    print_error "未找到 Mach-O 二进制文件"
    print_info "请确保将 .app 文件放在 ./MachOFiles 目录下"
    exit 2
fi

binname=$(basename "$macho_bin")
print_info "二进制文件: $macho_bin"
print_info "应用名称: $binname"

# 4. 导出为 lcov 格式
print_info "导出覆盖率数据为 lcov 格式..."
xcrun llvm-cov export "$macho_bin" \
    -instr-profile="$profdata_path" \
    -format=lcov > ${binname}.info

print_info "lcov 文件已生成: ${binname}.info"

# 5. 增量覆盖率分析
if [ -n "$oldCommit" ] && [ -f "gitdiff.diff" ]; then
    print_info "执行增量覆盖率分析..."
    
    # 检查 Ruby 脚本是否存在
    if [ -f "gitdiff/utils/diffParser.rb" ]; then
        ruby gitdiff/utils/diffParser.rb \
            --diff-file=gitdiff.diff \
            --coverage-info-file=${binname}.info
        
        # 6. 生成增量覆盖率 HTML 报告
        if [ -f "${binname}_gather.info" ]; then
            print_info "生成增量覆盖率 HTML 报告..."
            genhtml -o ${binname}_incremental_html \
                ./${binname}_gather.info \
                --ignore-errors category \
                --title "增量代码覆盖率报告 (${oldCommit}..${currentCommit})"
            
            print_info "增量报告已生成: ${binname}_incremental_html/index.html"
        else
            print_warn "增量覆盖率 info 文件未生成"
        fi
    else
        print_warn "diffParser.rb 脚本不存在，跳过增量分析"
    fi
else
    print_info "跳过增量分析（未提供对比 commit）"
fi

# 7. 生成全量覆盖率 HTML 报告
print_info "生成全量覆盖率 HTML 报告..."
genhtml -o ${binname}_full_html \
    ${binname}.info \
    --ignore-errors category \
    --title "全量代码覆盖率报告 (${currentCommit})"

print_info "全量报告已生成: ${binname}_full_html/index.html"

# 8. 打印摘要
print_info "=================================="
print_info "覆盖率报告生成完成!"
print_info "=================================="

if [ -d "${binname}_incremental_html" ]; then
    print_info "增量报告: ${binname}_incremental_html/index.html"
fi
print_info "全量报告: ${binname}_full_html/index.html"

# 尝试打开报告
if command -v open &> /dev/null; then
    print_info "正在打开全量报告..."
    open ${binname}_full_html/index.html
fi

exit 0
