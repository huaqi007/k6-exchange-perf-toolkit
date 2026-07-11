#!/usr/bin/env bash
# ============================================================
# scripts/run-all.sh — 一键运行全量压测
#
# 用法:
#   bash scripts/run-all.sh              # 全部场景
#   bash scripts/run-all.sh order-stress # 单个场景
#
# 前置条件:
#   1. npm install
#   2. npm run build
#   3. mock 服务已启动 (npm run mock)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$ROOT_DIR/dist"
RESULTS_DIR="$ROOT_DIR/results"
SUMMARY_FILE="$RESULTS_DIR/summary-$(date +%Y%m%d-%H%M%S).txt"

mkdir -p "$RESULTS_DIR"

SCENARIOS=(
  "order-stress"
  "market-data-ws"
  "matching-engine"
  "rpc-node"
  "grpc-service"
  "cosmos-query"
  "e2e-trading"
)

run_scenario() {
  local name="$1"
  local script="$DIST_DIR/${name}.js"

  if [ ! -f "$script" ]; then
    echo "[SKIP] $name — $script not found (run 'npm run build' first)"
    return 0
  fi

  echo ""
  echo "============================================"
  echo " Running: $name"
  echo "============================================"
  echo ""

  # 每个场景输出独立的 JSON，供 summary 阶段可靠解析 checks 结果（不依赖 TTY Unicode 符号）
  k6 run --out "json=$RESULTS_DIR/${name}.json" "$script" 2>&1 | tee "$RESULTS_DIR/${name}.log"

  echo ""
  echo "[DONE] $name — log: results/${name}.log"
}

# 从 k6 JSON 输出解析 checks 通过/失败数（需要 jq）。
# 回退：若无 jq 或无 JSON 文件，返回 "?/?"。
parse_checks() {
  local json="$1"
  if ! command -v jq > /dev/null 2>&1 || [ ! -f "$json" ]; then
    echo "?/?"
    return
  fi
  local total passed failed
  # k6 --out json 产出 JSONL（每行一个 JSON 对象），-s (slurp) 合并为数组后处理
  total=$(jq -s 'map(select(.type=="Point" and .metric=="checks") | .data.value) | add // 0' "$json")
  passed=$(jq -s 'map(select(.type=="Point" and .metric=="checks" and .data.tags.result=="pass") | .data.value) | add // 0' "$json")
  failed=$((total - passed))
  echo "${passed}/${failed}"
}

# ---- Main ----
echo "k6 Exchange Performance Toolkit — Full Test Suite"
echo "Start time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Results:    $RESULTS_DIR"
echo ""

if [ $# -gt 0 ]; then
  # Run specific scenario
  run_scenario "$1"
else
  # Run all scenarios
  for scenario in "${SCENARIOS[@]}"; do
    run_scenario "$scenario"
  done
fi

# Summary
echo "" > "$SUMMARY_FILE"
echo "Test Summary ($(date -u +%Y-%m-%dT%H:%M:%SZ))" >> "$SUMMARY_FILE"
echo "========================================" >> "$SUMMARY_FILE"
for scenario in "${SCENARIOS[@]}"; do
  json="$RESULTS_DIR/${scenario}.json"
  log="$RESULTS_DIR/${scenario}.log"
  if [ -f "$json" ] || [ -f "$log" ]; then
    checks="$(parse_checks "$json")"
    pass="${checks%%/*}"
    fail="${checks##*/}"
    echo "  $scenario: checks passed=$pass failed=$fail" >> "$SUMMARY_FILE"
  else
    echo "  $scenario: SKIPPED" >> "$SUMMARY_FILE"
  fi
done

echo ""
echo "All tests completed."
echo "Summary: $SUMMARY_FILE"
