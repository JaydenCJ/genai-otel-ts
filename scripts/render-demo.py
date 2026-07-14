#!/usr/bin/env python3
"""Renders docs/assets/demo.gif - an animated terminal-style demo of the
one-line instrumentation and the span it produces.

The span attributes and token numbers shown are copied from a real run of
the packed library against the `openai` npm package. The GIF is rendered frame by frame with Pillow and the
system DejaVu Sans Mono font (no screen-recording tools required), so it
is fully reproducible. Re-run after changing the demo content:

    python3 scripts/render-demo.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "demo.gif"

# Colors: terminal-ish palette that reads on light and dark GitHub themes.
C = {
    "bg": "#0d1117",
    "chrome": "#161b22",
    "border": "#30363d",
    "text": "#e6edf3",
    "dim": "#8b949e",
    "green": "#3fb950",
    "blue": "#79c0ff",
    "purple": "#d2a8ff",
    "yellow": "#e3b341",
    "prompt": "#7ee787",
}

# (text, color, indent, bold)
LINES = [
    ("$ cat app.ts", C["prompt"], 0, True),
    ('import { instrument } from "genai-otel-ts";', C["text"], 0, False),
    ("const openai = instrument(new OpenAI()); // the one line", C["text"], 0, False),
    ("", C["text"], 0, False),
    ("$ node --import ./otel.js app.js", C["prompt"], 0, True),
    ("span  chat gpt-4o-mini  (kind: CLIENT)", C["yellow"], 0, True),
    ("gen_ai.operation.name        = chat", C["blue"], 1, False),
    ("gen_ai.provider.name         = openai", C["blue"], 1, False),
    ("gen_ai.request.model         = gpt-4o-mini", C["blue"], 1, False),
    ("gen_ai.response.model        = gpt-4o-mini-2024-07-18", C["blue"], 1, False),
    ("gen_ai.response.finish_reasons = [ 'stop' ]", C["blue"], 1, False),
    ("gen_ai.usage.input_tokens    = 14", C["purple"], 1, False),
    ("gen_ai.usage.output_tokens   = 19", C["purple"], 1, False),
    ("exported via OTLP -> Grafana / Jaeger / any OTel backend", C["green"], 1, False),
]

TITLE = "genai-otel-ts — one line, standard GenAI spans"

WIDTH = 760
LINE_HEIGHT = 26
PAD_TOP = 64
PAD_LEFT = 24
HEIGHT = PAD_TOP + len(LINES) * LINE_HEIGHT + 20
STEP_MS = 550  # one new line per step
HOLD_MS = 4000  # hold the finished screen before looping

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONT = ImageFont.truetype(str(FONT_DIR / "DejaVuSansMono.ttf"), 15)
FONT_BOLD = ImageFont.truetype(str(FONT_DIR / "DejaVuSansMono-Bold.ttf"), 15)
FONT_TITLE = ImageFont.truetype(str(FONT_DIR / "DejaVuSansMono.ttf"), 13)


def base_frame() -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), C["bg"])
    draw = ImageDraw.Draw(img)
    # Terminal window: rounded body + title-bar chrome with traffic lights.
    draw.rounded_rectangle(
        (0, 0, WIDTH - 1, HEIGHT - 1), radius=10, fill=C["bg"], outline=C["border"]
    )
    draw.rounded_rectangle((0, 0, WIDTH - 1, 35), radius=10, fill=C["chrome"])
    draw.rectangle((0, 26, WIDTH - 1, 35), fill=C["chrome"])
    for cx, color in ((20, "#ff5f57"), (40, "#febc2e"), (60, "#28c840")):
        draw.ellipse((cx - 6, 12, cx + 6, 24), fill=color)
    draw.text((WIDTH / 2, 18), TITLE, font=FONT_TITLE, fill=C["dim"], anchor="mm")
    return img


def frame_with_lines(count: int) -> Image.Image:
    img = base_frame()
    draw = ImageDraw.Draw(img)
    for i, (text, color, indent, bold) in enumerate(LINES[:count]):
        if not text:
            continue
        x = PAD_LEFT + indent * 24
        y = PAD_TOP + i * LINE_HEIGHT
        draw.text((x, y), text, font=FONT_BOLD if bold else FONT, fill=color)
    return img


def main() -> None:
    frames = [frame_with_lines(n) for n in range(1, len(LINES) + 1)]
    durations = [STEP_MS] * (len(frames) - 1) + [HOLD_MS]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    total_s = sum(durations) / 1000
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(frames)} frames, {total_s:.1f}s loop)")


if __name__ == "__main__":
    main()
