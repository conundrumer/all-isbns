"""
Takes a text file of publisher ISBN prefixes and generates PNGs of publisher ranges
"""

import argparse
from pathlib import Path
from tqdm import tqdm

from plot import get_plot_pos, init_plots, save_plots

def process_data(input_path: Path, output_path: Path) -> None:
    print(f"### Processing {input_path}")

    images = init_plots()

    with open(input_path, 'r', encoding='utf-8') as f:
        lines = [*f]
        for line in tqdm(lines):
            isbn = line.strip()
            size = len(isbn)

            x, y = get_plot_pos(isbn)

            images[size - 4].putpixel((x, y), 1)

    save_plots(images, output_path)
    print(f"### Outputs written to {output_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    args = parser.parse_args()

    process_data(args.input, args.output)

if __name__ == '__main__':
    main()