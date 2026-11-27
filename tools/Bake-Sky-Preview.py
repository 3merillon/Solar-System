"""Bake the always-available 128px cube from the six survey JPEGs in the solar pack."""

from pathlib import Path

import numpy as np
from PIL import Image


def main():
    root = Path(__file__).resolve().parents[1]
    faces = []
    for face in range(6):
        with Image.open(root / f"web/pack/solar/sky-{face}.jpg") as image:
            if image.size != (2048, 2048):
                raise ValueError(f"Unexpected sky face dimensions: {image.size}")
            srgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
        linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
        mean = linear.reshape(128, 16, 128, 16, 3).mean(axis=(1, 3))
        srgb = np.where(mean <= .0031308, 12.92 * mean, 1.055 * mean ** (1 / 2.4) - .055)
        faces.append(np.rint(255 * srgb).clip(0, 255).astype(np.uint8).tobytes())
    path = root / "crates/solar-explorer/data/sky-preview.rgb"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b"".join(faces))


if __name__ == "__main__":
    main()
