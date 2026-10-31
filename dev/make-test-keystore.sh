#!/usr/bin/env bash
# 当前文件：make-test-keystore.sh
#
# 生成「测试版固定签名」用的密钥（只需做一次）。生成之后所有测试包都用它签名，
# 新包才能直接覆盖安装旧包（否则 Android 会报 INSTALL_FAILED_UPDATE_INCOMPATIBLE）。
#
# 用法（在仓库根目录）：
#   ./dev/make-test-keystore.sh
#
# 产出：
#   android/keystore/folia-perf.jks     —— 放进仓库后 CI 自动使用
#   屏幕上的 base64                     —— 想用 secret 的话，存成 FOLIA_TEST_KEYSTORE_BASE64
#
# 注意：这是测试密钥，口令写在 android/app/build.gradle 里，任何拿到仓库的人都能用它签名。
# 它只用于自用的测试包，不能用于对外发布；正式发布请用你自己的 release keystore。

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TARGET="$ROOT/android/keystore/folia-perf.jks"
ALIAS="folia-perf"
STOREPASS="folia-perf-test"

command -v keytool >/dev/null || { echo "缺少 keytool（装一个 JDK 21）" >&2; exit 1; }

if [ -e "$TARGET" ]; then
    echo "已经存在：$TARGET"
    echo "要重新生成请先自己备份并删除它；重新生成会让已装的包无法覆盖升级。"
    exit 1
fi

mkdir -p "$(dirname "$TARGET")"
keytool -genkeypair \
    -keystore "$TARGET" \
    -storetype JKS \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$STOREPASS" \
    -keypass "$STOREPASS" \
    -dname "CN=Folia Perf Test, OU=Perf Builds, O=Folia, C=CN"

echo
echo "证书指纹（两次构建相同才说明能覆盖安装）："
keytool -list -v -keystore "$TARGET" -storepass "$STOREPASS" | grep -E "SHA256:" | head -1

echo
echo "下一步二选一："
echo "  A. 提交进仓库： git add android/keystore/folia-perf.jks && git commit -m 'chore(android): 固定测试签名'"
echo "  B. 存成 secret：gh secret set FOLIA_TEST_KEYSTORE_BASE64 < <(base64 -w0 \"$TARGET\")"
