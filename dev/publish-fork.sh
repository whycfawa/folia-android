#!/usr/bin/env bash
# 当前文件：publish-fork.sh
#
# 把本地分支推到自己的 GitHub fork，触发 Actions 构建，并把 APK 下载到下载目录。
#
# 前置：
#   1. 本机已安装 gh 并登录：gh auth login（需要 repo + workflow 权限）
#   2. 在仓库根目录执行（脚本会用 git rev-parse 找根）
#
# 用法：
#   ./scripts/publish-fork.sh                 # fork（已存在则复用）→ 推送 → 等构建 → 下 APK
#   ./scripts/publish-fork.sh --branch foo    # 换分支
#   ./scripts/publish-fork.sh --no-wait       # 只推送，不等构建
#
# 说明：fork 到自己账号是 GitHub 的一次写入，重复执行是安全的（已 fork 会跳过）。

set -euo pipefail

UPSTREAM="whycfawa/folia-android"
BRANCH="perf/mobile-profile"
WAIT=1
WORKFLOW="android-apk.yml"
OUT_DIR="${DOWNLOAD_DIR:-$HOME/Downloads}"

while [ $# -gt 0 ]; do
    case "$1" in
        --branch)  BRANCH="${2:?--branch 需要分支名}"; shift 2 ;;
        --no-wait) WAIT=0; shift ;;
        -h|--help) sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "未知参数：$1" >&2; exit 2 ;;
    esac
done

command -v gh >/dev/null || { echo "缺少 gh：https://cli.github.com/" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "未登录：先跑 gh auth login" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git rev-parse --verify "$BRANCH" >/dev/null 2>&1 || { echo "本地没有分支 $BRANCH" >&2; exit 1; }

GH_USER="$(gh api user -q .login)"

# fork 一次；已经 fork 过时 gh 会报错，这里当成成功。
if gh repo view "$GH_USER/folia-android" >/dev/null 2>&1; then
    echo "已存在 fork：$GH_USER/folia-android"
else
    echo "创建 fork：$UPSTREAM → $GH_USER/folia-android"
    gh repo fork "$UPSTREAM" --clone=false
fi

if git remote get-url fork >/dev/null 2>&1; then
    git remote set-url fork "https://github.com/$GH_USER/folia-android.git"
else
    git remote add fork "https://github.com/$GH_USER/folia-android.git"
fi

echo "推送 $BRANCH 到 fork …"
git push -u fork "$BRANCH"

if [ "$WAIT" -eq 0 ]; then
    echo "已推送。构建页：https://github.com/$GH_USER/folia-android/actions/workflows/$WORKFLOW"
    exit 0
fi

echo "等待 Actions 开始 …"
sleep 5
RUN_ID="$(gh run list --repo "$GH_USER/folia-android" --workflow "$WORKFLOW" --branch "$BRANCH" \
    --limit 1 --json databaseId -q '.[0].databaseId')"

if [ -z "${RUN_ID:-}" ]; then
    echo "没找到构建记录，去 Actions 页看一眼：https://github.com/$GH_USER/folia-android/actions" >&2
    exit 1
fi

echo "构建 ID=$RUN_ID，开始跟踪（失败会直接退出）"
gh run watch "$RUN_ID" --repo "$GH_USER/folia-android" --exit-status

mkdir -p "$OUT_DIR"
gh run download "$RUN_ID" --repo "$GH_USER/folia-android" -D "$OUT_DIR/folia-apk" >/dev/null
APK="$(find "$OUT_DIR/folia-apk" -name '*.apk' -print -quit)"

echo
echo "APK：${APK:-（未找到）}"
[ -n "$APK" ] && echo "安装：adb install -r \"$APK\""
