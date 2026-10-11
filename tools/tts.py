#!/usr/bin/env python3
"""逐镜头生成配音，并导出句级时间戳。

edge-tts 对中文只发 SentenceBoundary（中文无空格），offset/duration 单位 100 纳秒。
句级时长即为动画时间轴；字幕所需的字级时间由 compose.mjs 按字插值补出。

用法：./.venv/bin/python tools/tts.py [期目录]
      （不给期目录就用当前目录，所以 cd 进期目录后直接跑也行）
"""
import asyncio
import json
import pathlib
import re
import subprocess
import sys

import edge_tts

TOOLS = pathlib.Path(__file__).resolve().parent
REPO = TOOLS.parent
VIDEOS = REPO / "videos"
SLUG_RE = re.compile(r"[A-Za-z0-9._-]+")


def available_episodes():
    if not VIDEOS.is_dir():
        return []
    return sorted(p.name for p in VIDEOS.iterdir() if (p / "script.json").exists())


def fail(msg, hint=None):
    print(f"\n✗ {msg}", file=sys.stderr)
    if hint:
        print(f"  {hint}", file=sys.stderr)
    names = available_episodes()
    if names:
        print(f"\n  可选期目录：{'  '.join(names)}", file=sys.stderr)
    print(file=sys.stderr)
    sys.exit(1)


def load_episode(argv):
    """最多一个位置参数：期目录。认不出来就报错，绝不回退到当前目录——
    那会默默把配音写进错的一期。"""
    if len(argv) > 2:
        fail(f"多余的参数：{' '.join(argv[2:])}", "用法：python tools/tts.py [期目录]")

    arg = argv[1] if len(argv) > 1 else None
    ep = pathlib.Path(arg).resolve() if arg else pathlib.Path.cwd().resolve()

    if not ep.is_dir():
        fail(f"期目录不存在：{arg}")
    if ep != REPO and REPO not in ep.parents:
        fail(f"期目录必须在仓库内：{ep}", "本地渲染服务只服务仓库里的文件。")
    if not SLUG_RE.fullmatch(ep.name):
        fail(f"期目录名只能用字母、数字、点、下划线、连字符：{ep.name}")
    if not (ep / "script.json").exists():
        fail(f"{arg} 里没有 script.json，不是期目录")
    return ep


EP = load_episode(sys.argv)
OUT = EP / "audio"
SCRIPT = json.loads((EP / "script.json").read_text(encoding="utf-8"))


def probe_duration(path):
    """用 ffprobe 读 mp3 真实时长；ffmpeg 未就绪时返回 None。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=20,
        )
        return float(out.stdout.strip())
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
        return None


async def synth(text, voice, rate, mp3_path):
    """合成一段语音，返回句级时间戳（秒）。"""
    spans = []
    with open(mp3_path, "wb") as f:
        async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"].endswith("Boundary"):
                spans.append({
                    "text": chunk["text"],
                    "start": chunk["offset"] / 1e7,
                    "dur": chunk["duration"] / 1e7,
                })
    return spans


async def main():
    voice, rate = SCRIPT["voice"], SCRIPT["rate"]
    print(f"期目录 {EP.relative_to(REPO)}")
    print(f"音色 {voice}   语速 {rate}\n")

    OUT.mkdir(exist_ok=True)
    timing = {}
    for shot in SCRIPT["shots"]:
        sid = shot["id"]
        mp3 = OUT / f"{sid}.mp3"
        spans = await synth(shot["vo"], voice, rate, mp3)

        voiced_end = max(s["start"] + s["dur"] for s in spans)
        file_dur = probe_duration(mp3)

        timing[sid] = {
            "vo": shot["vo"],
            "spans": spans,
            "voiced_end": round(voiced_end, 3),
            "file_dur": round(file_dur, 3) if file_dur else None,
        }
        (OUT / f"{sid}.json").write_text(
            json.dumps(timing[sid], ensure_ascii=False, indent=2), encoding="utf-8")

        tail = f"{file_dur:.2f}s" if file_dur else "n/a"
        print(f"{sid}  语音止于 {voiced_end:5.2f}s   文件 {tail:>7}   {len(spans)} 句")
        for s in spans:
            print(f"      {s['start']:5.2f} → {s['start']+s['dur']:5.2f}  {s['text']}")

    (OUT / "timing.json").write_text(
        json.dumps(timing, ensure_ascii=False, indent=2), encoding="utf-8")

    total = sum(t["voiced_end"] for t in timing.values())
    print(f"\n纯语音合计 {total:.2f}s（未含镜头间留白）")


asyncio.run(main())
