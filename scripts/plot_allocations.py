"""
Takes an XML of ISBN ranges and generates PNGs of publisher allocation ranges
"""

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET
from tqdm import tqdm

from common import normalize_isbn
from plot import get_plot_pos, init_plots, save_plots

def process_data(input_path: Path, output_path: Path) -> None:
    print(f"### Processing {input_path}")

    images = init_plots()

    with open(input_path, 'r') as f:
        xml_content = f.read()
        root = ET.fromstring(xml_content)

        total_rules = 0
        for rule in root.find('RegistrationGroups').findall('.//Rule'):
            if int(rule.find('Length').text) > 0:
                total_rules += 1

        pbar = tqdm(total=total_rules)

        for group in root.findall('.//Group'):
            prefix = normalize_isbn(group.find('Prefix').text)

            for rule in group.findall('.//Rule'):
                length = int(rule.find('Length').text)
                if length == 0:
                    continue

                range_text = rule.find('Range').text
                size = len(prefix) + length
                [start, end] = [int(prefix + s[:length]) for s in range_text.split('-')]

                image = images[size - 4]

                for i in range(start, end + 1):
                    isbn = str(i).rjust(size, '0')
                    image.putpixel(get_plot_pos(isbn), 1)

                pbar.update(1)

        pbar.close()

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