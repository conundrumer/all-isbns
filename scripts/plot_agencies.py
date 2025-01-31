"""
Takes a json file of agencies and generates a PNG of agency ranges
"""

from PIL import Image, ImageDraw
import json
import argparse
from pathlib import Path

from plot import init_plots
from common import HEIGHT, WIDTH, get_pos

def process_data(input_path: Path, output_path: Path) -> None:
    print(f"### Processing {input_path}")

    image = Image.new('1', (WIDTH // 100, HEIGHT // 100))

    with input_path.open() as f:
        data = json.load(f)
        for prefix in data.keys():
            x, y = get_pos(prefix)
            if len(prefix) == 2:
                w, h = (10_000, 10_000)
            else:
                w, h = get_pos('0' * (len(prefix) - 2) + '11')

            ImageDraw.Draw(image).rectangle([x // 100, y // 100, (x+w) // 100 - 1, (y+h) // 100 - 1], fill=1)

    image.save(output_path, optimize=True, compress_level=9)

    print(f"### Output written to {output_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    args = parser.parse_args()

    process_data(args.input, args.output)

if __name__ == '__main__':
    main()