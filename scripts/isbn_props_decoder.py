from dataclasses import dataclass
from typing import List, Optional, Iterator, BinaryIO
import io

@dataclass
class ISBNPropsRecord:
    isbn_positions: List[int]
    holdings_count: Optional[int]
    year: Optional[int]

class ISBNPropsDecoder:
    def decode_stream(self, stream: BinaryIO) -> Iterator[ISBNPropsRecord]:
        """Decode a sequence of encoded records from a file-like object.

        Args:
            stream: A file-like object supporting read() method for reading bytes.
                   This can be a file opened in binary mode, io.BytesIO, etc.

        Yields:
            DecodedRecord objects containing the decoded data.

        Raises:
            ValueError: If the stream contains incomplete or invalid record data.
            IOError: If there are issues reading from the stream.
        """
        while True:
            # Read start byte
            start_byte = stream.read(1)
            if not start_byte:  # End of stream
                break

            start_byte = start_byte[0]
            has_count = bool(start_byte & (1 << 7))
            has_year = bool(start_byte & (1 << 6))
            isbn_count = (start_byte & 0x3F)

            # Calculate size of remaining record data
            record_size = isbn_count * 4  # ISBN positions
            if has_count:
                record_size += 1
            if has_year:
                record_size += 1

            # Read the entire record data at once
            record_data = stream.read(record_size)
            if len(record_data) < record_size:
                raise ValueError("Incomplete record data")

            pos = 0

            # Read holdings count if present
            holdings_count = None
            if has_count:
                holdings_count = record_data[pos]
                pos += 1

            # Read year if present
            year = None
            if has_year:
                year_byte = record_data[pos]
                year = 2025 - year_byte
                pos += 1

            # Read ISBN positions
            isbn_positions = []
            for _ in range(isbn_count):
                position = int.from_bytes(record_data[pos:pos + 4], byteorder='big')
                isbn_positions.append(position)
                pos += 4

            yield ISBNPropsRecord(
                isbn_positions=isbn_positions,
                holdings_count=holdings_count,
                year=year
            )

    def decode_bytes(self, data: bytes) -> Iterator[ISBNPropsRecord]:
        """Convenience method to decode from bytes using BytesIO."""
        return self.decode_stream(io.BytesIO(data))

import unittest

class TestRecordDecoder(unittest.TestCase):
    def setUp(self):
        self.decoder = ISBNPropsDecoder()

    def test_single_record_with_all_fields(self):
        # Start byte: 11000000 (has_count=1, has_year=1, isbn_count=1)
        # Count byte: 42 (holdings_count=42)
        # Year byte: 5 (year=2020)
        # ISBN position: 1000
        data = bytes([
            0b11000001,  # Start byte
            42,          # Holdings count
            5,           # Year
            0, 0, 3, 232 # ISBN position 1000
        ])

        # Test with BytesIO
        stream = io.BytesIO(data)
        records = list(self.decoder.decode_stream(stream))
        self.assertEqual(len(records), 1)
        record = records[0]

        self.assertEqual(record.holdings_count, 42)
        self.assertEqual(record.year, 2020)
        self.assertEqual(record.isbn_positions, [1000])

        # Test with decode_bytes convenience method
        records = list(self.decoder.decode_bytes(data))
        self.assertEqual(len(records), 1)
        record = records[0]

        self.assertEqual(record.holdings_count, 42)
        self.assertEqual(record.year, 2020)
        self.assertEqual(record.isbn_positions, [1000])

    def test_multiple_records_stream(self):
        data = bytes([
            # First record
            0b11000001,  # Start byte
            42,          # Holdings count
            5,           # Year
            0, 0, 3, 232, # ISBN position 1000
            # Second record
            0b11000001,  # Start byte
            100,         # Different holdings count
            10,          # Different year
            0, 0, 7, 208  # ISBN position 2000
        ])

        stream = io.BytesIO(data)
        records = list(self.decoder.decode_stream(stream))
        self.assertEqual(len(records), 2)

        self.assertEqual(records[0].holdings_count, 42)
        self.assertEqual(records[0].year, 2020)
        self.assertEqual(records[0].isbn_positions, [1000])

        self.assertEqual(records[1].holdings_count, 100)
        self.assertEqual(records[1].year, 2015)
        self.assertEqual(records[1].isbn_positions, [2000])

    def test_incomplete_stream(self):
        data = bytes([
            0b11000001,  # Start byte
            42,          # Holdings count
            5,           # Year
            0, 0        # Incomplete ISBN position
        ])

        stream = io.BytesIO(data)
        with self.assertRaises(ValueError) as context:
            list(self.decoder.decode_stream(stream))

        self.assertIn("Incomplete record data", str(context.exception))

    def test_empty_stream(self):
        stream = io.BytesIO(bytes([]))
        records = list(self.decoder.decode_stream(stream))
        self.assertEqual(len(records), 0)

if __name__ == '__main__':
    unittest.main()