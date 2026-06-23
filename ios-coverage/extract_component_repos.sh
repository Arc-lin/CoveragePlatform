#!/bin/sh
# 输出 Podfile.lock 里所有 git 源组件的 {name, repositoryUrl, commitHash} JSON 数组，
# 供 CI 调 POST /api/builds 时作为 componentRepos 字段传给平台——平台拉壳工程仓库找不到
# 某个文件的源码时，会依次去这份清单里的仓库按各自的 commitHash 再试一遍。
#
# 没有 Podfile.lock，或没有 git 源依赖时，输出空数组 []（单仓库项目不受影响，不用传这个字段）。
#
# 用法：extract_component_repos.sh <repo_root>

set -e

REPO_ROOT="${1:-.}"
LOCKFILE="$REPO_ROOT/Podfile.lock"

if [ ! -f "$LOCKFILE" ]; then
  echo "[]"
  exit 0
fi

ruby -ryaml -rjson -e '
lock = YAML.load_file(ARGV[0])
checkout = lock["CHECKOUT OPTIONS"] || {}
components = checkout.map { |pod, opts|
  commit = opts[:commit] || opts["commit"]
  git = opts[:git] || opts["git"]
  next nil unless commit && git
  { name: pod, repositoryUrl: git, commitHash: commit }
}.compact
puts components.to_json
' "$LOCKFILE"
