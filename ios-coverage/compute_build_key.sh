#!/bin/sh
# 计算覆盖率平台用的"构建身份"（buildKey）。
#
# 单工程项目：直接输出壳工程的完整 commit hash，跟原来的行为完全一样。
# 组件化项目（CocoaPods + git 源依赖）：检测到 Podfile.lock 里的 CHECKOUT OPTIONS 段后，
# 把壳工程 commit 和所有 git 源组件锁定的 commit 拼起来算 sha256，作为复合指纹。
# 这样即使壳工程自己的代码没变、只是某个组件升级了版本，buildKey 也会跟着变。
#
# Xcode Run Script Build Phase 和 CI 流程必须调用这同一份脚本，保证两边算出来的值完全一致——
# 任何一边单独改算法都会导致 SDK 端 GET /api/builds/resolve 查不到对应的 Build。
#
# 用法：compute_build_key.sh <repo_root>

set -e

REPO_ROOT="${1:-.}"
COMMIT_HASH=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")

BUILD_KEY="$COMMIT_HASH"
LOCKFILE="$REPO_ROOT/Podfile.lock"

if [ -f "$LOCKFILE" ]; then
  COMPONENT_COMMITS=$(ruby -ryaml -e '
    lock = YAML.load_file(ARGV[0])
    checkout = lock["CHECKOUT OPTIONS"] || {}
    pairs = checkout.map { |pod, opts|
      commit = opts[:commit] || opts["commit"]
      commit ? "#{pod}=#{commit}" : nil
    }.compact.sort
    puts pairs.join(",")
  ' "$LOCKFILE" 2>/dev/null || true)

  if [ -n "$COMPONENT_COMMITS" ]; then
    BUILD_KEY=$(printf "%s|%s" "$COMMIT_HASH" "$COMPONENT_COMMITS" | shasum -a 256 | awk '{print $1}')
  fi
fi

echo "$BUILD_KEY"
