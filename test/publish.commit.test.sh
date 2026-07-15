#!/usr/bin/env bash
# publish.sh 行为测试：发布成功后应自动提交 package.json 版本改动
# 用 stub 替身隔离 vsce / npm version / nvm，不真实发布，只验证 git 提交行为
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH_SH="$REPO_ROOT/publish.sh"

pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

# 每个用例在独立临时 git 仓库中跑,PATH 前置 stub 目录劫持 npm/vsce
setup_sandbox() {
  SANDBOX="$(mktemp -d)"
  BIN="$SANDBOX/bin"; mkdir -p "$BIN"
  cp "$PUBLISH_SH" "$SANDBOX/publish.sh"
  chmod +x "$SANDBOX/publish.sh"

  cd "$SANDBOX"
  git init -q
  git config user.email t@t.com
  git config user.name tester
  printf '{\n  "name": "cj-gitlab",\n  "version": "0.1.36"\n}\n' > package.json
  git add package.json
  git commit -qm init

  # stub npm：npm version patch --no-git-tag-version → 写入新版本并回显 vNEW
  cat > "$BIN/npm" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "version" ]; then
  node -e 'const f="package.json";const p=require("./"+f);const a=p.version.split(".");a[2]=String(+a[2]+1);p.version=a.join(".");require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n");console.log("v"+p.version)'
  exit 0
fi
exit 0
STUB
  chmod +x "$BIN/npm"

  # stub node：拦截版本探测使其报 >=18(绕过 publish.sh 的 node18 守卫),其余透传真实 node
  REAL_NODE="$(command -v node)"
  cat > "$BIN/node" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "-p" ] && [[ "\${2:-}" == *"process.versions.node"* ]]; then echo 20; exit 0; fi
if [ "\$1" = "-v" ]; then echo v20.0.0; exit 0; fi
exec "$REAL_NODE" "\$@"
STUB
  chmod +x "$BIN/node"

  # stub npx vsce：什么都不做,视 $VSCE_RESULT 决定成败
  cat > "$BIN/npx" <<STUB
#!/usr/bin/env bash
exit \${VSCE_RESULT:-0}
STUB
  chmod +x "$BIN/npx"

  export PATH="$BIN:$PATH"
  export HOME="$SANDBOX"   # 屏蔽真实 ~/.nvm
}

teardown_sandbox() { cd /; rm -rf "$SANDBOX"; }

# ── 用例1：发布成功后,package.json 版本改动被提交 ──────────────
setup_sandbox
VSCE_RESULT=0 bash ./publish.sh patch >/dev/null 2>&1 || true
NEWVER="$(node -p 'require("./package.json").version')"
if [ "$NEWVER" = "0.1.37" ]; then ok "版本已 bump 到 0.1.37"; else bad "版本未 bump (得到 $NEWVER)"; fi
# 必须产生了新提交(非 init)且该提交改动了 package.json,且工作区无残留未提交
HEADMSG="$(git log -1 --pretty=%s)"
COMMITTED_PKG="$(git show --name-only --pretty=format: HEAD | grep -c '^package.json$' || true)"
CLEAN_PKG="$([ -z "$(git status --porcelain package.json)" ] && echo yes || echo no)"
if [ "$HEADMSG" != "init" ] && [ "$COMMITTED_PKG" -ge 1 ] && [ "$CLEAN_PKG" = "yes" ]; then
  ok "版本改动已提交(HEAD 提交含 package.json,工作区干净): \"$HEADMSG\""
else
  bad "版本改动未正确提交 (HEAD=\"$HEADMSG\" pkgInCommit=$COMMITTED_PKG cleanPkg=$CLEAN_PKG)"
fi
teardown_sandbox

# ── 用例2：发布失败(vsce 非0)时,不应提交(版本可 bump 但不 commit,便于回滚) ──
setup_sandbox
VSCE_RESULT=1 bash ./publish.sh patch >/dev/null 2>&1 || true
LASTMSG="$(git log -1 --pretty=%s)"
if [ "$LASTMSG" = "init" ]; then
  ok "发布失败时未产生提交"
else
  bad "发布失败仍产生了提交: $LASTMSG"
fi
teardown_sandbox

# ── 用例3：package.json 预先有无关改动时,不得被裹挟进 release 提交 ──
# 场景：开发者 package.json 里有 WIP 改动(如新增 script),发布时不应把它混进版本提交
setup_sandbox
# 制造无关的、未提交的 package.json 改动
node -e 'const f="package.json";const p=require("./"+f);p.scripts={dev:"UNRELATED_WIP"};require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")'
VSCE_RESULT=0 bash ./publish.sh patch >/dev/null 2>&1 || true
# 断言：若产生了 release 提交,该提交不得包含 UNRELATED_WIP;或干脆不自动提交(留给开发者手动处理)
HEADMSG3="$(git log -1 --pretty=%s)"
if [ "$HEADMSG3" = "init" ]; then
  # 选择：脏 package.json 时跳过自动提交(安全,不误标)
  ok "package.json 预先脏时跳过自动提交(未误裹挟)"
elif git show HEAD -- package.json | grep -q "UNRELATED_WIP"; then
  bad "无关改动 UNRELATED_WIP 被裹挟进 release 提交: \"$HEADMSG3\""
else
  ok "release 提交仅含版本改动,未裹挟无关改动: \"$HEADMSG3\""
fi
teardown_sandbox

echo ""
echo "结果: $pass 通过, $fail 失败"
[ "$fail" -eq 0 ]
