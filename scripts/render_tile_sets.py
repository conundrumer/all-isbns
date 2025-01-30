"""
Renders visualizations of ISBNs at multiple scales over multiple sets
"""

import os
import argparse
from pathlib import Path
from typing import OrderedDict, cast
from PIL import Image, ImageChops
import bencodepy
from tqdm import tqdm
import zstandard
from collections import defaultdict

from common import ISBNsBinaryProcessor, get_isbn_code_pos

class PILISBNsBinaryProcessor(ISBNsBinaryProcessor):
    def create_block(self):
        return Image.new("1", self.get_size(), 0)

    def add_to_block(self, block, x, y):
        block.putpixel((x, y), 1)

def save_block(path: Path, id: int, block: Image.Image):
    block_greyscale = block.convert('L')
    block_float = block.convert('F')
    os.makedirs(path, exist_ok=True)

    prefix = str(id).rjust(2, '0')

    scales = [(1, 50), (2, 25), (5, 10), (10, 5), (20, 1)]

    pbar = tqdm(total=sum(d * d for d, _ in scales), desc=str(id), position=1, leave=False)

    for divisions, factor in scales:
        n = 10_000 // divisions

        k = 1 / factor / factor

        for i in range(divisions):
            for j in range(divisions):
                box = (j * n, i * n, (j+1) * n, (i+1) * n)
                if factor == 1:
                    tile = block.crop(box)
                elif factor < 16:
                    tile = block_greyscale.reduce(factor, box)
                else:
                    # don't let singular pixels get rounded down to zero
                    tile = block_float.reduce(factor, box)
                    tile = tile.point(lambda x: (x / 255 - k) / (1 - k) * 254 + 1)
                    tile = tile.convert('L')

                if any(x != 0 for x in tile.getdata()):
                    tile.save(path / f"{divisions}_{prefix}_{i}_{j}.png", optimize=True, compress_level=9)

                    # TODO: yield?

                pbar.update(1)

def process_data(input_path: Path, output_path: Path) -> None:
    print(f"### Processing {input_path}")

    isbn_data = bencodepy.bread(zstandard.ZstdDecompressor().stream_reader(open(input_path, 'rb')))
    isbn_data = cast(OrderedDict, isbn_data)

    processor = PILISBNsBinaryProcessor()

    md5_blocks = {}
    all_blocks = defaultdict(processor.create_block)

    print(f"### Processing md5")
    for id, block in processor.process(isbn_data[b'md5']):
        md5_blocks[id] = block

        save_block(output_path / "md5", id, block)

    for set_name, packed_isbns_binary in isbn_data.items():
        set_name = set_name.decode()
        if set_name == 'md5':
            continue

        # to dev more quickly, early break
        # if set_name == 'edsebk':
        #     break

        print(f"### Processing {set_name}")
        for id, block in processor.process(packed_isbns_binary):
            all_blocks[id] = ImageChops.logical_or(all_blocks[id], block)

            block_in = ImageChops.logical_and(block, md5_blocks[id])
            save_block(output_path / f"{set_name}_in", id, block_in)

            # block_out = ImageChops.logical_and(block, ImageChops.invert(md5_blocks[id]))
            block_out = ImageChops.subtract(block, block_in)
            save_block(output_path / f"{set_name}_out", id, block_out)

    print(f"### Processing all sets")
    for id, block in all_blocks.items():
        block_in = ImageChops.logical_and(block, md5_blocks[id])
        save_block(output_path / f"all_in", id, block_in)

        # block_out = ImageChops.logical_and(block, ImageChops.invert(md5_blocks[id]))
        block_out = ImageChops.subtract(block, block_in)
        save_block(output_path / f"all_out", id, block_out)

    print(f"### Outputs written to {output_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    args = parser.parse_args()

    process_data(args.input, args.output)

if __name__ == '__main__':
    main()