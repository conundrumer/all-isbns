import io
import json
from pathlib import Path
import struct
from typing import Iterator
import zstandard
from tqdm import tqdm

def normalize_isbn(isbn: str, dashes=False) -> str:
    """
    Normalize ISBN by replacing 978- with 0 and 979- with 1
    """
    if isbn.startswith('978-'):
        isbn = '0' + isbn[4:]
    elif isbn.startswith('979-'):
        isbn = '1' + isbn[4:]

    if not dashes:
        isbn = isbn.replace('-', '')
    return isbn

WIDTH = 50_000
HEIGHT = 40_000

def get_pos(isbn: str) -> tuple[int, int]:
    x = 0
    y = 0
    n = 4
    is_row = True
    for digit in map(int, isbn):
        if is_row:
            y += digit * 10 ** n
        else:
            x += digit * 10 ** n

            # adjust from 10x2 to 5x4
            if n == 4:
                y = 2 * y + x // 50_000
                x %= 50_000

            n -= 1

        is_row = not is_row

    return x, y

def get_isbn_code_pos(code: int) -> tuple[int, int]:
    x = 0
    y = 0
    i = 0
    while code > 0:
        inc = (code % 10) * 10 ** (i // 2)
        if i % 2 == 0:
            x += inc
        else:
            y += inc
        code //= 10
        i += 1

    return x, y

class ISBNsBinaryProcessor:
    def get_size(self):
        return (10_000, 10_000)

    def create_block(self):
        raise NotImplementedError

    def add_to_block(self, block, x, y):
        raise NotImplementedError

    def process(self, packed_isbns_binary):
        packed_isbns_ints = struct.unpack(f'{len(packed_isbns_binary) // 4}I', packed_isbns_binary)
        isbn_streak = True # Alternate between reading `isbn_streak` and `gap_size`.
        position = 0 # ISBN (without check digit) is `978000000000 + position`.
        offset = 0

        N = 100_000_000
        block = self.create_block()

        for value in tqdm(packed_isbns_ints, position=0):
            if isbn_streak:
                for _ in range(0, value):
                    x, y = get_isbn_code_pos(position - offset)

                    self.add_to_block(block, x, y)

                    position += 1

                    if position - offset >= N:
                        yield ((position - 1) // N, block)
                        offset = (position // N) * N
                        block = self.create_block()
            else: # Reading `gap_size`.
                position += value
                if position - offset >= N:
                    yield ((position - value) // N, block)
                    offset = (position // N) * N
                    block = self.create_block()

            isbn_streak = not isbn_streak

        yield (position // N, block)

class CompressedByteTracker:
    """Wrapper to track compressed bytes read from a file."""
    def __init__(self, file):
        self.file = file
        self.compressed_pos = 0

    def read(self, size):
        data = self.file.read(size)
        self.compressed_pos += len(data)
        return data

    def tell(self):
        return self.compressed_pos

def read_zst_jsonl(filepath: Path) -> Iterator[dict]:
    """Read a .jsonl.zst file line by line with a progress bar based on compressed file size."""
    total_size = filepath.stat().st_size

    with open(filepath, 'rb') as fh:
        tracked_file = CompressedByteTracker(fh)
        dctx = zstandard.ZstdDecompressor()
        stream_reader = dctx.stream_reader(tracked_file)
        text_stream = io.TextIOWrapper(stream_reader, encoding='utf-8')

        pbar = tqdm(total=total_size, unit='B', unit_scale=True)

        while True:
            try:
                line = text_stream.readline()
                if not line:
                    break
                if line.strip():  # Skip empty lines
                    # Update based on compressed bytes
                    pbar.update(tracked_file.tell() - pbar.n)
                    yield json.loads(line)
            except Exception as e:
                print(f"Error processing line: {e}")
                continue
        pbar.close()
