from collections import defaultdict
from pathlib import Path
from random import random
from typing import Set, Iterator
import json
import io
import zstandard
import re
from rich.live import Live
from rich.table import Table
from rich.console import Console, Group
from rich.progress import Progress, FileSizeColumn, TotalFileSizeColumn, TransferSpeedColumn, TimeElapsedColumn

input_filename = Path("data/annas_archive_meta__aacid__worldcat__20241230T203056Z--20241230T203056Z.jsonl.seekable.zst")

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

def read_zst_jsonl(filepath: Path, progress: Progress = None) -> Iterator[dict]:
    """Read a .jsonl.zst file line by line with a progress bar based on compressed file size."""
    total_size = filepath.stat().st_size

    # Allow external progress tracking or create our own
    external_progress = progress is not None
    if not external_progress:
        progress = Progress(
            *Progress.get_default_columns(),
            FileSizeColumn(),
            TotalFileSizeColumn(),
        )

    task = progress.add_task("[cyan]Reading compressed file...", total=total_size)

    try:
        with open(filepath, 'rb') as fh:
            tracked_file = CompressedByteTracker(fh)
            dctx = zstandard.ZstdDecompressor()
            stream_reader = dctx.stream_reader(tracked_file)
            text_stream = io.TextIOWrapper(stream_reader, encoding='utf-8')

            if not external_progress:
                progress.start()

            counter = 0
            while True:
                try:
                    line = text_stream.readline()
                    if not line:
                        break

                    # counter += 1
                    # if counter % 40_073 > 30:
                    #     continue

                    if line.strip():  # Skip empty lines
                        progress.update(task, completed=tracked_file.tell())

                        yield json.loads(line)
                except Exception as e:
                    print(f"Error processing line: {e}")
                    continue
    finally:
        if not external_progress:
            progress.stop()



def extract_most_likely_year(strings: list[str]) -> int | None:
    """
    Extract the most likely publication year from multiple strings using a tiered approach.

    Args:
        strings (list): List of strings that might contain publication years

    Returns:
        int or None: Most likely publication year, or None if no valid year is found
    """
    current_year = 2025

    def find_years_in_range(strings, start_year, end_year):
        years = []
        pattern = r'\d{4}'
        for text in strings:
            matches = re.finditer(pattern, str(text))
            for match in matches:
                year = int(match.group())
                if start_year <= year <= end_year:
                    years.append(year)
        return years

    # Tier 1: Check 1950-1999 first (most likely period)
    years = find_years_in_range(strings, 1950, 1999)
    if years:
        return max(set(years), key=years.count)  # Return most common year

    # Tier 2: Try 1900-current
    years = find_years_in_range(strings, 1900, current_year)
    if years:
        return max(set(years), key=years.count)

    # Tier 3: Try 1800-current
    years = find_years_in_range(strings, 1800, current_year)
    if years:
        return max(set(years), key=years.count)

    # Tier 4: Last resort - try 1450-current
    years = find_years_in_range(strings, 1450, current_year)
    if years:
        return max(set(years), key=years.count)

    return None

curr_oclc_number = "0000000000000"
data = {}
END_YEAR = 2020
table = defaultdict(lambda: [0 for i in range(10)])


def generate_table(data):
    # Create a fresh table each update
    table = Table()

    table.add_column("Decade", justify="right")
    # table.add_column("1")
    for i in range(1, 10):
        table.add_column(str(i), justify="right")
        # table.add_column(f"{1 << i}-{((1 << (i+1)) - 1)}")
    # table.add_column(">512")
    table.add_column(">9", justify="right")

    table.add_column("Total", justify="right")

    totals = [0 for i in range(10)]
    for year in sorted(data.keys()):
        table.add_row("<1800" if year == 1790 else "N/A" if year == 9000 else str(year), *(str(n) if n > 0 else "" for n in data[year]), str(sum(data[year])))

        for i in range(10):
            totals[i] += data[year][i]

    table.add_section()
    table.add_row("Total", *(str(n) if n > 0 else "" for n in totals), str(sum(totals)))

    return table

progress = Progress(
    *Progress.get_default_columns(),
    TimeElapsedColumn(),
    FileSizeColumn(),
    TransferSpeedColumn(),
    TotalFileSizeColumn(),
)

console = Console()

with Live(console=console, refresh_per_second=30) as live:
    counter = 0
    for record in read_zst_jsonl(input_filename, progress=progress):
        metadata = record.get('metadata')
        oclc_number = metadata.get('oclc_number')

        metadata_record = metadata.get('record')
        if metadata_record is not None:
            for field in ['totalHoldingCount', 'isbn13', 'isbns', 'title', 'machineReadableDate', 'publicationDate', 'date']:
                value = metadata_record.get(field)
                if value is not None:
                    if field == 'isbn13' and value == '':
                        continue
                    if field == 'isbns' and len(value) == 0:
                        continue

                    write = True

                    if field in data:
                        if field == 'totalHoldingCount':
                            data[field] = max(data[field], value)
                            write = False

                    if write:
                        data[field] = value


        if oclc_number is None:
            break
            # raise "oclc_number is None"

        if curr_oclc_number != oclc_number:
            if 'totalHoldingCount' in data and 'isbns' in data:
                year = extract_most_likely_year([data[k] for k in ['machineReadableDate', 'publicationDate', 'date'] if k in data])

                # count_bin = min(9, data['totalHoldingCount'].bit_length() - 1)
                count_bin = min(9, data['totalHoldingCount'] - 1)
                if year:
                    year = max(1790, year)

                    table[year // 10 * 10][count_bin] += 1
                else:
                    table[9000][count_bin] += 1

                counter += 1

                if counter % 10 == 0:
                    # print()
                    # for year in sorted(table.keys()):
                    #     counts = table[year]
                    #     print(f"{year}\t{'\t'.join(str(x) for x in counts)}")

                    # Update the display
                    live.update(Group(generate_table(table), progress))


            curr_oclc_number = oclc_number
            data = {}

