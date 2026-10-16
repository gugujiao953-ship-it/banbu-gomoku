#!/usr/bin/env bash
# 半步五子棋 v1.1.8 宣传片 导出
# 用法: bash encode.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # -> marketing/v1.1.8

VIDEO=video
FR=$VIDEO/frames
OUT=$VIDEO/半步五子棋打谱-v1.1.8-宣传片.mp4
BGM=$VIDEO/bgm.wav

echo "== 帧数 =="; ls "$FR" | wc -l

echo "== 编码视频 =="
ffmpeg -y -hide_banner -loglevel warning -stats \
  -framerate 30 -i "$FR/f%05d.jpg" \
  -i "$BGM" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.0 \
  -x264-params "keyint=60:min-keyint=30:scenecut=0:ref=4:bframes=3" \
  -c:a aac -b:a 192k -ar 44100 \
  -shortest -movflags +faststart \
  "$OUT"

echo "== 完成 =="
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 "$OUT"
