"""
Renders ISBN properties into tiles
"""

import argparse
import bencodepy
from tqdm import tqdm
import numpy as np
from typing import BinaryIO, OrderedDict, cast
from PIL import Image

from pathlib import Path
import numpy as np
from typing import Iterator

import zstandard

from common import ISBNsBinaryProcessor, get_isbn_code_pos
from isbn_props_decoder import ISBNPropsDecoder

class ISBNMatrixProcessor:
    def __init__(self):
        self.decoder = ISBNPropsDecoder()
        # Dictionary to store 3D tensors (10_000 x 10_000 x 2) for each prefix
        # Index 0 in last dimension is for years (as offset from 2025)
        # Index 1 in last dimension is for holdings count
        # Value 0 means no data
        from collections import defaultdict
        self.tensors = defaultdict(lambda: np.full((10_000, 10_000, 2), 0, dtype=np.uint8))

        self.zero_holdings_mats = defaultdict(lambda: np.full((10_000, 10_000), False, dtype=bool))

    def process_stream(self, stream: BinaryIO) -> None:
        """Process a binary stream of ISBN properties."""
        for record in self.decoder.decode_stream(stream):
            if record.year is None and record.holdings_count == 0:
                continue

            for position in record.isbn_positions:
                # Extract prefix (first 2 digits) and remainder
                prefix = position // 100_000_000
                remainder = position % 100_000_000

                # Get row and column for the remainder
                col, row = get_isbn_code_pos(remainder)

                # defaultdict automatically creates matrix if needed
                matrix = self.tensors[prefix]

                if record.year is not None:
                    # year_offset low to high -> more old
                    year_offset = 2025 - record.year

                    # combine publication year by choosing the older year
                    matrix[row, col, 0] = max(matrix[row, col, 0], min(255, year_offset + 1))
                if record.holdings_count is not None:
                    if record.holdings_count > 0:
                        # encoded_count low to high -> more rare
                        encoded_count = max(1, 256 - record.holdings_count)
                        prev_value = matrix[row, col, 1]

                        if prev_value == 0:
                            # if no data, directly set it
                            matrix[row, col, 1] = encoded_count
                        else:
                            # combine holdings count by choosing the less rare count
                            matrix[row, col, 1] = min(prev_value, encoded_count)
                    else:
                        self.zero_holdings_mats[prefix][row, col] = True

    def process_file(self, file_path: Path) -> None:
        """
        Process a file of ISBN properties into numpy tensors.

        Args:
            file_path: Path to the binary file containing ISBN properties
        """
        # Get file size for progress bar
        file_size = file_path.stat().st_size

        with open(file_path, 'rb') as f:
            with tqdm(total=file_size, desc="Processing ISBNs", unit='B', unit_scale=True) as pbar:
                # Create a wrapper that updates progress based on reads
                class ProgressReader:
                    def __init__(self, f, pbar):
                        self.f = f
                        self.pbar = pbar

                    def read(self, size):
                        data = self.f.read(size)
                        self.pbar.update(len(data))
                        return data

                self.process_stream(ProgressReader(f, pbar))

def split_tensor(tensor: np.ndarray, mask: np.ndarray, dtype=np.uint8) -> tuple[np.ndarray, np.ndarray]:
    """
    Split a tensor into two based on a boolean mask.

    Args:
        tensor: Input tensor of shape (10000, 10000, 2)
        mask: Boolean matrix of shape (10000, 10000)

    Returns:
        Tuple of (true_tensor, false_tensor) where each is (10000, 10000, 2)
        Values where mask is False get 0 in true_tensor
        Values where mask is True get 0 in false_tensor
    """
    # Create two new tensors filled with 0
    true_tensor = np.full_like(tensor, 0, dtype=dtype)
    false_tensor = np.full_like(tensor, 0, dtype=dtype)

    # Expand mask to match tensor shape for broadcasting
    mask_3d = mask[:, :, np.newaxis]

    # Copy values based on mask
    np.copyto(true_tensor, tensor, where=mask_3d)
    np.copyto(false_tensor, tensor, where=~mask_3d)

    return true_tensor, false_tensor

CATEGORIES = ['years', 'holdings']

def iter_tensor_tiles(prefix: int, tensor: np.ndarray, scales: list[tuple[int, int]]) -> Iterator[tuple[str, Path, np.ndarray]]:
    """
    Generate tiles from a tensor, yielding (category, path, data) for each tile.

    Args:
        prefix: Two-digit prefix string
        tensor: 10000x10000x2 numpy array containing year offsets and holdings
        scales: list of (divisions, factor) tuples

    Yields:
        Tuples of (category, tile_name, tile_data) where:
            category: 'years' or 'holdings'
            tile_name: name of tile
            tile_data: numpy array containing the tile data
    """
    # Process both year offsets (dim 0) and holdings (dim 1)
    # for dim, category in enumerate(CATEGORIES):
    #     data = tensor[:, :, dim]

    for divisions, factor in scales:
        n = 10_000 // divisions

        for i in range(divisions):
            for j in range(divisions):
                for dim, category in enumerate(CATEGORIES):
                    # Extract tile coordinates
                    row_start = i * n
                    row_end = (i + 1) * n
                    col_start = j * n
                    col_end = (j + 1) * n

                    if factor == 1:
                        tile = tensor[row_start:row_end, col_start:col_end, dim]
                    else:
                        # Reshape and take minimum for each block
                        tile_data = tensor[row_start:row_end, col_start:col_end, dim]
                        shape = (n // factor, factor, n // factor, factor)
                        tile = tile_data.reshape(shape).max(axis=(1, 3))

                    # Yield tile data or None if empty
                    tile_name = Path(f"{divisions}_{str(prefix).zfill(2)}_{i}_{j}")
                    if np.any(tile != 0):
                        yield category, tile_name, tile.astype(np.uint8)
                    else:
                        yield category, tile_name, None

class NumpyISBNsBinaryProcessor(ISBNsBinaryProcessor):
    def create_block(self):
        return np.full(self.get_size(), False, dtype=bool)
    def add_to_block(self, block, x, y):
        block[y, x] = True

def process_data(input_path: Path, output_path: Path, isbncodes_path: Path) -> None:
    print(f"### Processing {input_path}")

    isbncodes_data = bencodepy.bread(zstandard.ZstdDecompressor().stream_reader(open(isbncodes_path, 'rb')))
    isbncodes_data = cast(OrderedDict, isbncodes_data)

    isbncodes_processor = NumpyISBNsBinaryProcessor()

    processor = ISBNMatrixProcessor()

    processor.process_file(input_path)

    print(f"### Rendering to {output_path}")

    for category in CATEGORIES:
        (output_path / f"{category}_in").mkdir(parents=True, exist_ok=True)
        (output_path / f"{category}_out").mkdir(parents=True, exist_ok=True)

    scales = [(1, 50), (2, 25), (5, 10), (10, 5), (20, 2), (50, 1)]

    # Calculate total number of potential tiles
    total_tiles = 2 * 2 * len(processor.tensors) * sum(d * d for d, _ in scales)  # *2 for years and holdings *2 for in/out

    print(sorted(processor.tensors.keys()))

    with tqdm(total=total_tiles, position=1) as pbar:
        for prefix, md5_mask in isbncodes_processor.process(isbncodes_data[b'md5']):
            tensor = processor.tensors.get(prefix)

            if tensor is None:
                print(f"Prefix {prefix} not found in tensors!")
                continue

            tensor_in, tensor_out = split_tensor(tensor, md5_mask)
            for t, suffix in [(tensor_in, 'in'), (tensor_out, 'out')]:
                for category, rel_path, tile_data in iter_tensor_tiles(prefix, t, scales):
                    if tile_data is not None:
                        out_path = output_path / f"{category}_{suffix}" / rel_path.with_suffix(".png")
                        Image.fromarray(tile_data, mode='L').save(out_path, format='png', optimize=True, compress_level=9)

                    pbar.update(1)

    print(f"### Outputs written to {output_path}")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Input file path')
    parser.add_argument('output', type=Path, help='Output path')
    parser.add_argument('--isbncodes', type=Path, help='aa_isbn13_codes')

    args = parser.parse_args()

    process_data(args.input, args.output, args.isbncodes)

if __name__ == "__main__":
    main()
