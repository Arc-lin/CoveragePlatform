set -e
API=http://localhost:3001/api
J() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(\"d$1\"))" 2>/dev/null; }
W=$(mktemp -d); cd "$W"
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; PASS=$((PASS+1)); else echo "  ❌ $1: got [$2] want [$3]"; FAIL=$((FAIL+1)); fi; }

# project
PID=$(curl -s -X POST $API/projects -H 'Content-Type: application/json' \
  -d '{"name":"zip-test","platform":"android","repositoryUrl":"https://github.com/x/y"}' | J "['data']['id']")
echo "project=$PID"

# trivial classfiles.zip (内容无关，create 不跑合并)
echo "x" > Foo.class; zip -q classfiles.zip Foo.class

echo "[1] 单仓库 diffs.zip {gitDiff}"
printf 'diff --git a/A b/A\n+++ b/A\n@@ -1,0 +1,1 @@\n+x\n' > app.diff
echo '{"gitDiff":"app.diff"}' > manifest.json
zip -q single.zip manifest.json app.diff
R=$(curl -s -X POST $API/builds -F "binary=@classfiles.zip" -F "diffs=@single.zip" \
  -F "projectId=$PID" -F "commitHash=c1" -F "branch=main")
BID=$(echo "$R" | J "['data']['id']")
B=$(curl -s $API/builds/$BID)
ck "201 创建成功" "$(echo "$R" | J "['success']")" "True"
ck "gitDiffPath 已落库" "$(echo "$B" | J "['data'].get('gitDiffPath') is not None")" "True"
ck "moduleDiffs 为空(单仓库)" "$(echo "$B" | J "['data'].get('moduleDiffs',[]).__len__()")" "0"
GP=$(echo "$B" | J "['data']['gitDiffPath']")
ck "gitDiffPath 文件真实存在于容器内" "$(docker exec coverageplatform-backend-1 sh -c "[ -f '$GP' ] && echo yes")" "yes"
ck "落盘内容正确" "$(docker exec coverageplatform-backend-1 sh -c "grep -c '+x' '$GP'")" "1"

echo "[2] 多仓库 diffs.zip {entries} 仍正常"
echo '{"entries":[{"module":"app","diffFile":"app.diff"}]}' > manifest.json
zip -q multi.zip manifest.json app.diff
R=$(curl -s -X POST $API/builds -F "binary=@classfiles.zip" -F "diffs=@multi.zip" \
  -F "projectId=$PID" -F "commitHash=c2" -F "branch=main")
BID=$(echo "$R" | J "['data']['id']")
B=$(curl -s $API/builds/$BID)
ck "201 创建成功" "$(echo "$R" | J "['success']")" "True"
ck "moduleDiffs 有 1 条" "$(echo "$B" | J "['data']['moduleDiffs'].__len__()")" "1"
ck "无 gitDiffPath" "$(echo "$B" | J "['data'].get('gitDiffPath') is None")" "True"

echo "[3] 坏 manifest（既无 entries 也无 gitDiff）→ 400"
echo '{"foo":1}' > manifest.json; zip -q bad.zip manifest.json
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/builds -F "binary=@classfiles.zip" -F "diffs=@bad.zip" \
  -F "projectId=$PID" -F "commitHash=c3" -F "branch=main")
ck "返回 400" "$C" "400"

echo "[4] 路径穿越 {gitDiff:'../../../etc/passwd'} → 400"
echo '{"gitDiff":"../../../etc/passwd"}' > manifest.json; zip -q trav.zip manifest.json
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/builds -F "binary=@classfiles.zip" -F "diffs=@trav.zip" \
  -F "projectId=$PID" -F "commitHash=c4" -F "branch=main")
ck "返回 400" "$C" "400"

# cleanup
curl -s -X DELETE $API/projects/$PID >/dev/null
for b in $(curl -s $API/builds/project/$PID | J "[x['id'] for x in __import__('json').load(__import__('sys').stdin)['data']]" 2>/dev/null); do :; done
cd /; rm -rf "$W"
echo ""; echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" = 0 ]
