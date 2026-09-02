#!/bin/bash
# 一版方案 → 全套资产。用法： bash 分析/build_scheme.sh A
set -e
ID="$1"; [ -z "$ID" ] && { echo "用法: build_scheme.sh <方案号>"; exit 1; }
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/分析"

echo "=== 方案 $ID：白模几何（吊顶 3.0） ==="
RENDER_OUT="/tmp/s_$ID"      python3 render.py --export --scheme "$ID"
echo "=== 方案 $ID：白模几何（裸顶 4.28） ==="
RENDER_OUT="/tmp/s_$ID"      python3 render.py --export --bare --scheme "$ID"
echo "=== 方案 $ID：底图 ＋ 线稿（吊顶） ==="
RENDER_OUT="/tmp/s_$ID"      python3 render.py all --clay --scheme "$ID" --w 1536 --h 1024
echo "=== 方案 $ID：底图 ＋ 线稿（裸顶） ==="
RENDER_OUT="/tmp/s_$ID"      python3 render.py all --clay --bare --scheme "$ID" --w 1536 --h 1024

cd "$ROOT"
mkdir -p "schemes/$ID"/{clays,bares,lines,lines_bare} models
cp "/tmp/s_$ID/model_${ID}_clay.json"  "models/model_${ID}_clay.json"
cp "/tmp/s_${ID}_bare/model_${ID}_bare.json" "models/model_${ID}_bare.json"
i=1
for v in $(python3 -c "
import sys; sys.path.insert(0,'分析')
import scheme_json as S
print(' '.join(S.auto_views(S.load('$ID'))))"); do
  n=$(printf "%02d" $i)
  cp "/tmp/s_$ID/${v}_clay.png"           "schemes/$ID/clays/$n.png"
  cp "/tmp/s_${ID}_bare/${v}_clay.png"    "schemes/$ID/bares/$n.png"
  cp "/tmp/s_$ID/ai/${v}_line.png"        "schemes/$ID/lines/$n.png"
  cp "/tmp/s_${ID}_bare/ai/${v}_line.png" "schemes/$ID/lines_bare/$n.png"
  i=$((i+1))
done
echo "=== 方案 $ID 全套资产完成：schemes/$ID/ ＋ models/model_${ID}_{clay,bare}.json ==="
ls -la "schemes/$ID"/clays
