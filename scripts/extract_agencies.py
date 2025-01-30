"""
Takes an XML of ISBN ranges and generates a JSON of:
{ [ISBN prefix]: "country/language/agency" }
"""

import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from common import normalize_isbn

def process_data(input_path: Path, output_path: Path) -> None:
    print(f"### Processing {input_path}")

    isbn_map = {}

    with open(input_path, 'r') as f:
        xml_content = f.read()
        root = ET.fromstring(xml_content)

        for group in root.findall('.//Group'):
            prefix = normalize_isbn(group.find('Prefix').text)
            agency = group.find('Agency').text

            isbn_map[prefix] = agency

    with open(output_path, 'w') as f:
        json.dump(isbn_map, f, separators=(',', ':'), sort_keys=True, ensure_ascii=False)

    print(f"### Output written to {output_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    args = parser.parse_args()

    process_data(args.input, args.output)

if __name__ == '__main__':
    main()