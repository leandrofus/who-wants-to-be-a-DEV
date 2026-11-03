#!/usr/bin/env bash
# Assembles out/trailer.mp4 from: frames/a, frames/b (deterministic title renders), out/gameplay.mp4 (real game capture), out/score.wav.
set -euo pipefail
cd "$(dirname "$0")"
FONT=/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-SemiBold.otf
cap() { # cap "text" start end
  echo "drawtext=fontfile=$FONT:text='$1':fontsize=62:fontcolor=white:shadowcolor=black@0.85:shadowx=3:shadowy=3:x=(w-text_w)/2:y=h*0.115:alpha='if(lt(t,$2+0.4),max(0,(t-$2)/0.4),if(gt(t,$3-0.4),max(0,($3-t)/0.4),1))':enable='between(t,$2,$3)'"
}
shot() { # shot index start end -> trimmed + dip-to-black fades
  d=$(python3 -c "print($3-$2)")
  echo "[1:v]trim=start=$2:end=$3,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.12,fade=t=out:st=$(python3 -c "print(round($d-0.12,3))"):d=0.12,fps=30,format=yuv420p[s$1];"
}
{
  echo "[0:v]fps=30,format=yuv420p[a];[2:v]fps=30,format=yuv420p[b];"
  shot 1 3.0 9.0; shot 2 9.2 13.0; shot 3 13.4 18.8; shot 4 31.4 35.3
  echo "[a][s1][s2][s3][s4][b]concat=n=6:v=1:a=0,"
  echo "$(cap "Pick the topics you are working on" 28.0 32.7),"
  echo "$(cap "Questions come from your own repo" 33.3 36.6),"
  echo "$(cap "Answer while your agent works" 37.2 41.3),"
  echo "$(cap "Get alerted the moment it is done" 42.5 45.9),"
  echo "eq=contrast=1.05:saturation=1.08,vignette=PI/5.5,format=yuv420p[v]"
} > out/graph.txt
ffmpeg -v error -stats -y -framerate 30 -i frames/a/%05d.jpg -i out/gameplay.mp4 -framerate 30 -i frames/b/%05d.jpg -i out/score.wav \
  -filter_complex_script out/graph.txt \
  -filter_complex "[3:a]aecho=0.8:0.55:45|95|180:0.35|0.25|0.15,highpass=f=25,loudnorm=I=-16:TP=-1.5:LRA=9[aud]" \
  -map "[v]" -map "[aud]" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -movflags +faststart -shortest out/trailer.mp4
ffprobe -v error -show_entries format=duration,size -of default=nw=1 out/trailer.mp4
