#!/usr/bin/env bash
# ============================================================
# scripts/fetch-cosmos-proto.sh — 下载 Cosmos SDK proto 文件
#
# cosmos-query 场景依赖以下 proto（默认不随仓库提供，需下载）:
#   proto/cosmos/bank/v1beta1/query.proto
#   proto/cosmos/base/query/v1beta1/pagination.proto
#   proto/cosmos/base/v1beta1/coin.proto
#   proto/gogoproto/gogo.proto
#
# 用法:
#   bash scripts/fetch-cosmos-proto.sh [COSMOS_SDK_VERSION]
#   例: bash scripts/fetch-cosmos-proto.sh v0.50.4
# ============================================================
set -euo pipefail

SDK_VERSION="${1:-v0.50.4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROTO_DIR="$ROOT_DIR/proto"

RAW_BASE="https://raw.githubusercontent.com/cosmos/cosmos-sdk/${SDK_VERSION}/proto"
GOGO_URL="https://raw.githubusercontent.com/cosmos/gogoproto/main/gogoproto/gogo.proto"

# cosmos-sdk proto 相对路径列表
COSMOS_FILES=(
  "cosmos/bank/v1beta1/query.proto"
  "cosmos/base/query/v1beta1/pagination.proto"
  "cosmos/base/v1beta1/coin.proto"
)

echo "Fetching Cosmos SDK ($SDK_VERSION) proto files into $PROTO_DIR ..."

fetch() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  echo "  -> $dest"
  curl -sSfL "$url" -o "$dest"
}

for rel in "${COSMOS_FILES[@]}"; do
  fetch "${RAW_BASE}/${rel}" "${PROTO_DIR}/${rel}"
done

# gogoproto 来自独立仓库
fetch "$GOGO_URL" "${PROTO_DIR}/gogoproto/gogo.proto"

echo "Done. Cosmos proto files ready under proto/."
