"""
Takes isbngrp_records and generates a JSON of:
{ [ISBN prefix]: ["publisher", ...] }

And a text file of all publisher ISBN prefixes
"""

import argparse
from collections import defaultdict
import json
from pathlib import Path

from tqdm import tqdm

from common import normalize_isbn, read_zst_jsonl

def process_data(input_path: Path, output_path: Path, output2_path: Path) -> None:
    print(f"### Processing {input_path}")

    size = 0
    isbn_map = defaultdict(list)

    for record in read_zst_jsonl(input_path):
        record = record.get('metadata').get('record')
        name = record.get('registrant_name')
        isbns = record.get('isbns')

        for isbn_data in isbns:
            isbn_type = isbn_data.get('isbn_type')

            if isbn_type == 'prefix':
                isbn = normalize_isbn(isbn_data.get('isbn'))

                if name is not None:
                    isbn_map[isbn].append(name)
                else:
                    isbn_map[isbn] = isbn_map[isbn]
            elif isbn_type == 'isbn13':
                isbn = normalize_isbn(isbn_data.get('isbn'), dashes=True)
                # agency-publisher-rest
                isbn = ''.join(isbn.split('-')[:2])
                # unknown parent publisher
                # isbn_map[isbn].append(name)

                isbn_map[isbn] = isbn_map[isbn]

    chunk = {}
    size = 0

    print(f"### Writing {output_path}")

    for isbn in tqdm(sorted(isbn_map.keys())):
        chunk[isbn] = isbn_map[isbn]

        size += len(isbn)
        for publisher in isbn_map[isbn]:
            size += len(publisher)

        if size > 100_000:
            first = next(iter(chunk))
            with open(output_path / f"{first}.json", 'w') as f:
                json.dump(chunk, f, separators=(',', ':'), sort_keys=True)

            chunk = {}
            size = 0

    print(f"### Writing {output2_path}")

    with open(output2_path, 'w', encoding='utf-8') as f:
        for isbn in sorted(isbn_map.keys()):
            f.write(f"{isbn}\n")
        f.seek(f.tell() - 1)
        f.truncate()

    print(f"### Output written to {output_path} and {output2_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    parser.add_argument('output2', type=Path, help='Output2 path')
    args = parser.parse_args()

    process_data(args.input, args.output, args.output2)

if __name__ == '__main__':
    main()