"""Breakpoint model comparison chart, sized for a single column.

The previous regeneration was 11 inches wide and got scaled to roughly 3.4
inches on the page, shrinking every label by a factor of three. This version
is drawn near its final printed size with correspondingly larger type, at
300 dpi, so nothing is downsampled into softness.

Writes both a PDF (vector, what the manuscript should include) and a PNG
(for previewing). Set OMNI_FIG_DIR to the manuscript directory; it defaults
to a sibling checkout of the paper next to this repository.

Usage:
    OMNI_FIG_DIR=/path/to/manuscript python scripts/make_figure7.py
"""
import os
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# The figure was renumbered from 7 to 6 when the unused first figure was
# dropped from the manuscript, so the basename is configurable too.
FIG_DIR = pathlib.Path(os.environ.get(
    "OMNI_FIG_DIR",
    pathlib.Path(__file__).resolve().parents[3]
    / "Structurally_Anchored_Framework_for_Cross_Language_Debugging"
      "__Language_Agnostic_Code_Execution_and_Intelligent_Debugging",
))
STEM = os.environ.get("OMNI_FIG_STEM", "Fig. 6")
OUT = FIG_DIR / (STEM + ".png")

metrics = ["Accuracy", "Precision", "Recall", "F1-Score"]
series = [
    ("Naive Bayes (NB)",         [0.560, 0.662, 0.478, 0.555], "#e3e3e3"),
    ("SVM",                      [0.804, 0.811, 0.858, 0.834], "#9a9a9a"),
    ("Random Forest (Proposed)", [0.842, 0.861, 0.864, 0.863], "#5b8fb9"),
]

x = np.arange(len(metrics))
width = 0.26

fig, ax = plt.subplots(figsize=(8.4, 4.3), dpi=300)
for i, (label, values, colour) in enumerate(series):
    bars = ax.bar(x + (i - 1) * width, values, width, label=label,
                  color=colour, edgecolor="black", linewidth=1.1, zorder=3)
    for bar, value in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 0.022,
                "%.2f" % value, ha="center", va="bottom", fontsize=13.5)

ax.set_ylabel("Scores", fontsize=17, fontweight="bold")
ax.set_xticks(x)
ax.set_xticklabels(metrics, fontsize=16)
ax.set_ylim(0.0, 1.12)
ax.set_yticks(np.arange(0.0, 1.01, 0.2))
ax.tick_params(axis="y", labelsize=15)
ax.tick_params(axis="both", width=1.1, length=5)
ax.yaxis.grid(True, linestyle="--", linewidth=0.9, color="#c8c8c8", zorder=0)
ax.set_axisbelow(True)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
for side in ("left", "bottom"):
    ax.spines[side].set_linewidth(1.1)
ax.legend(loc="upper center", bbox_to_anchor=(0.5, 1.16), ncol=3,
          frameon=False, fontsize=14.5, handlelength=1.5, handleheight=1.1,
          columnspacing=1.4)

fig.tight_layout()
# PDF first: it is vector, so it stays sharp at any zoom and is what the
# manuscript should \includegraphics. The PNG is kept for quick previewing.
OUT_PDF = OUT.with_suffix(".pdf")
fig.savefig(OUT_PDF, bbox_inches="tight", facecolor="white")
fig.savefig(OUT, bbox_inches="tight", facecolor="white")

from PIL import Image
im = Image.open(OUT)
print("wrote %s (vector)" % OUT_PDF.name)
print("wrote %s  %dx%d px" % (OUT.name, im.width, im.height))
print("printed at 3.4 in column width -> effective %d dpi" % round(im.width / 3.4))
