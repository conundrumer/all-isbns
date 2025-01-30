import json
from typing import Optional, Set
import struct
import re

from isbn_filter import filter_invalid_isbns
from processor_most_likely_year import extract_most_likely_year

def verify_isbn(isbn):
    """
    Verify ISBN-10 or ISBN-13 checksum.
    Returns True if valid, False otherwise.
    """
    # Remove any hyphens and spaces
    isbn = isbn.replace('-', '').replace(' ', '')

    # Determine ISBN type based on length
    if len(isbn) == 10:
        # ISBN-10 verification
        if not isbn[:-1].isdigit() or isbn[-1] not in '0123456789X':
            return False

        sum = 0
        for i in range(9):
            sum += int(isbn[i]) * (10 - i)

        last = 10 if isbn[-1] == 'X' else int(isbn[-1])
        sum += last

        return sum % 11 == 0

    elif len(isbn) == 13:
        # ISBN-13 verification
        if not isbn.isdigit():
            return False

        sum = 0
        for i in range(12):
            sum += int(isbn[i]) * (1 if i % 2 == 0 else 3)

        check_digit = (10 - (sum % 10)) % 10
        return check_digit == int(isbn[-1])

    else:
        return False

class DataHandler:
    """Handles processing of book records and converts them to a compact byte format.

    The byte format consists of:
    - Start byte: flags for holdings/year presence and ISBN count
    - Optional holdings count byte (count, max 255)
    - Optional year byte (2025-year, max 255)
    - Series of 32-bit ISBN position integers

    Records with more than 15 ISBNs are split into multiple chunks.
    Each chunk contains up to 15 ISBNs.
    """

    BASE_ISBN = 978000000000
    MAX_CHUNK_SIZE = 15

    def __init__(self):
        self.current_id: Optional[str] = None
        self.isbns: Set[str] = set()
        # self.isbn_positions: Set[int] = set()
        self.holdings_count: Optional[int] = None
        self.year: Optional[int] = None
        self.total_results: int = 0

        self.records = []

    def _get_isbn_position(self, isbn: str) -> Optional[int]:
        """Convert ISBN to position number.

        Args:
            isbn: ISBN string (10 or 13 digits with optional hyphens)

        Returns:
            Integer position or None if invalid
        """
        if not isbn or not isinstance(isbn, str):
            return None

        base = re.sub(r'[^0-9]', '', isbn)[:-1]
        if not base:
            return None

        if len(base) < 12:
            base = '978' + base

        try:
            position = int(base[-12:]) - 978_000_000_000
            if 0 <= position < 2**32:
                # prefix = position // 100_000_000
                # if prefix not in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 18]:
                #     print('bruh')
                #     print(isbn)
                #     print(json.dumps(self.records, indent=2, ensure_ascii=False))
                return position
        except ValueError:
            pass
        return None

    def _reset_state(self) -> None:
        """Reset all state variables to initial values."""
        self.current_id = None
        self.isbns.clear()
        # self.isbn_positions.clear()
        self.holdings_count = None
        self.year = None

        self.records.clear()

    def _create_bytes(self) -> Optional[bytes]:
        """Create bytes from current state."""

        # TODO: process from self.isbns
        # if not self.isbn_positions:
        #     return None

        if not self.isbns:
            return None

        isbns = filter_invalid_isbns({isbn for isbn in self.isbns if verify_isbn(isbn)})
        diff = {isbn for isbn in self.isbns if isbn not in isbns}
        # if diff:
        #     print([*isbns], [*diff])

        isbn_positions = set()

        # has_likely_error = False
        for isbn in isbns:
            pos = self._get_isbn_position(isbn)

            if pos is not None:
                if pos >= 1_000_000_000 and \
                    not (pos >= 1_100_000_000 and pos < 1_140_000_000) and \
                    not (pos >= 1_800_000_000 and pos < 1_900_000_000):
                    # sometimes they get prefixed with 979 when they're actually under 978
                    # assume that's the case and fix it
                    pos -= 1_000_000_000
                    # has_likely_error = True
                    # continue

                isbn_positions.add(pos)

        # if has_likely_error:
        #     print("likely error", self.isbns)
        #     print(json.dumps(self.records, indent=2, ensure_ascii=False))


        isbn_positions = sorted(isbn_positions)
        has_count = self.holdings_count is not None
        has_year = self.year is not None

        # we only care about records with isbns AND holdings and/or publication year
        if not (len(isbn_positions) > 0 and (has_count or has_year)):
            return None

        # TODO: look into formats. digital formats should be considered less rare or analyzed separately or cannot be held in the first place
        # if self.holdings_count == 0:
            # print('yo')
            # for record in self.records:
            #     generalFormat = record.get('record', {}).get('generalFormat')
            #     specificFormat = record.get('record', {}).get('specificFormat')
            #     if generalFormat is not None and generalFormat != 'Book':
            #         print(generalFormat, specificFormat)
            # print(json.dumps(self.records, indent=2, ensure_ascii=False))

        all_chunks = []
        for i in range(0, len(isbn_positions), self.MAX_CHUNK_SIZE):
            chunk = isbn_positions[i:i + self.MAX_CHUNK_SIZE]
            isbn_count = len(chunk)

            start_byte = ((1 if has_count else 0) << 7) | \
                        ((1 if has_year else 0) << 6) | \
                        (isbn_count & 0x0F)

            chunk_bytes = bytearray([start_byte])

            if has_count:
                holdings_byte = min(255, max(0, self.holdings_count))
                chunk_bytes.append(holdings_byte)
            if has_year:
                year_byte = min(255, max(0, 2025 - self.year))
                chunk_bytes.append(year_byte)

            for position in chunk:
                chunk_bytes.extend(struct.pack('>I', position))

            all_chunks.append(bytes(chunk_bytes))

        return b''.join(all_chunks) if all_chunks else None

    def process(self, data: dict) -> Optional[bytes]:
        """Process incoming data and return bytes when a record is complete."""
        oclc_id = data.get('metadata', {}).get('oclc_number')

        if oclc_id is None:  # End of batch
            if self.current_id is not None:
                result = self._create_bytes()
                self._reset_state()
                self.total_results += 1
                return result
            return None

        if self.current_id is not None and oclc_id != self.current_id:
            result = self._create_bytes()
            self._reset_state()
            self.current_id = oclc_id
            self.total_results += 1

            self._merge_record_data(data)
            return result

        if self.current_id is None:
            self.current_id = oclc_id

        self._merge_record_data(data)
        return None

    def _merge_record_data(self, data: dict) -> None:
        """Merge data from a new record into current state."""
        self.records.append(data.get('metadata', {}))

        record = data.get('metadata', {}).get('record', {})

        # Process and merge ISBNs
        isbns = set()
        if 'isbns' in record and record['isbns']:
            isbns.update(record['isbns'])

        if 'isbn13' in record and record['isbn13']:
            isbns.add(record['isbn13'])

        self.isbns.update(isbns)

        # has_likely_error = False
        # for isbn in isbns:
        #     pos = self._get_isbn_position(isbn)

        #     if pos is not None:
        #         prefix = pos // 100_000_000
        #         if prefix not in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 18]:
        #             has_likely_error = True
        #             continue

        #         self.isbn_positions.add(pos)

        # has_likely_error = False
        # for isbn in isbns:
        #     pos = self._get_isbn_position(isbn)

        #     if pos is not None:
        #         prefix = pos // 100_000_000
        #         if prefix not in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 18]:
        #             has_likely_error = True
        #             continue

        #         self.isbn_positions.add(pos)

        # if has_likely_error:
        #     print("likely error", isbns)

        # Update holdings count (take max)
        holdings_fields = ['totalHoldingCount', 'total_holding_count']
        for field in holdings_fields:
            if field in record:
                if self.holdings_count is None:
                    self.holdings_count = record[field]
                else:
                    self.holdings_count = max(self.holdings_count, record[field])

        # Update year (take min)
        year_fields = ['machineReadableDate', 'publicationDate', 'date']
        new_year = extract_most_likely_year([record.get(field) for field in year_fields if field in record])
        if new_year:
            if self.year is None:
                self.year = new_year
            else:
                self.year = min(self.year, new_year)

import unittest
from typing import Optional

class MockExtractYear:
    """Mock for extract_most_likely_year to use in tests."""
    def __call__(self, strings: list[str]) -> Optional[int]:
        # Simple mock that returns the first valid year found
        for s in strings:
            if isinstance(s, str) and s.isdigit() and 1000 <= int(s) <= 2025:
                return int(s)
        return None

def create_record(oclc_number: str, isbns: list[str] = None, isbn13: str = None,
                 holdings: int = None, year: str = None) -> dict:
    """Helper to create test records."""
    record = {'metadata': {'oclc_number': oclc_number, 'record': {}}}
    if isbns:
        record['metadata']['record']['isbns'] = isbns
    if isbn13:
        record['metadata']['record']['isbn13'] = isbn13
    if holdings is not None:
        record['metadata']['record']['totalHoldingCount'] = holdings
    if year:
        record['metadata']['record']['publicationDate'] = year
    return record

class TestDataHandler(unittest.TestCase):
    def setUp(self):
        self.handler = DataHandler()
        # Replace extract_most_likely_year with mock
        global extract_most_likely_year
        self._original_extract_year = extract_most_likely_year
        extract_most_likely_year = MockExtractYear()

    def tearDown(self):
        # Restore original extract_most_likely_year
        global extract_most_likely_year
        extract_most_likely_year = self._original_extract_year

    def test_isbn_position_calculation(self):
        """Test ISBN to position conversion."""
        test_cases = [
            ('9780000000014', 1),  # 13-digit ISBN
            ('0000000016', 1),     # 10-digit ISBN
            ('978-0-00-000123-4', 123),  # Hyphenated ISBN-13
            ('979-0-00-000456-7', 1000000456),  # ISBN-13 starting with 979
            ('9790000004567', 1000000456),    # Same ISBN without hyphens
            ('9790000000014', 1000000001),    # Minimum 979 position
            ('9790000000000', 1000000000),    # First 979 position
        ]

        for isbn, expected in test_cases:
            with self.subTest(isbn=isbn):
                result = self.handler._get_isbn_position(isbn)
                self.assertEqual(result, expected)

    def test_single_record_processing(self):
        """Test processing of a single record."""
        record = create_record(
            oclc_number='123',
            isbns=['9780000000014', '0000000016'],
            holdings=5,
            year='2000'
        )

        # First record should return None
        result = self.handler.process(record)
        self.assertIsNone(result)

        # End of batch should return bytes
        result = self.handler.process({'metadata': {'oclc_number': None}})
        self.assertIsNotNone(result)

        # Verify byte structure
        self.assertEqual(result[0], 0xC1)  # 11000000: has_count=1, has_year=1, isbn_count=1
        self.assertEqual(result[1], 5)     # holdings_count
        self.assertEqual(result[2], 25)    # 2025-2000

        # Should have one ISBN position (since both ISBNs resolve to position 1)
        self.assertEqual(len(result), 7)   # 3 header bytes + 4 bytes for ISBN position

    def test_multiple_records_same_oclc(self):
        """Test merging multiple records with same OCLC number."""
        records = [
            create_record('123', isbns=['9780000000014'], holdings=5),
            create_record('123', isbns=['0000000016'], holdings=10, year='2000'),
        ]

        for record in records[:-1]:
            result = self.handler.process(record)
            self.assertIsNone(result)

        result = self.handler.process(records[-1])
        self.assertIsNone(result)

        # End batch
        result = self.handler.process({'metadata': {'oclc_number': None}})
        self.assertIsNotNone(result)

        # Should have max holdings count
        self.assertEqual(result[1], 10)  # holdings_count = 10

    def test_record_boundary(self):
        """Test processing record boundaries."""
        records = [
            create_record('123', isbns=['9780000000014'], holdings=1),
            create_record('456', isbns=['0000000016'], holdings=1),
        ]

        # First record
        result = self.handler.process(records[0])
        self.assertIsNone(result)

        # Second record (different OCLC) should trigger output
        result = self.handler.process(records[1])
        self.assertIsNotNone(result)

    def test_large_isbn_set(self):
        """Test handling of more than 15 ISBNs."""
        # Create 20 unique valid positions
        isbns = [f'9780000{str(i).zfill(5)}1' for i in range(20)]

        # Verify our test data is valid first
        positions = set()
        for isbn in isbns:
            pos = self.handler._get_isbn_position(isbn)
            self.assertIsNotNone(pos, f"ISBN {isbn} produced invalid position")
            positions.add(pos)
        self.assertEqual(len(positions), 20, "Test data should produce 20 unique positions")

        # Process the record
        record = create_record('123', holdings=1, isbns=isbns)
        self.handler.process(record)
        result = self.handler.process({'metadata': {'oclc_number': None}})
        self.assertIsNotNone(result, "Result should not be None")

        # Should be split into two chunks
        chunk_size = 15 * 4 + 1 + 1  # 15 ISBNs * 4 bytes + 1 start byte + 1 for holdings
        self.assertEqual(len(result), chunk_size + (20-15) * 4 + 1 + 1)

        # First chunk should have 15 ISBNs
        self.assertEqual(result[0] & 0x0F, 15)  # isbn_count

        # Second chunk should have 5 ISBNs
        second_chunk_start = chunk_size
        self.assertEqual(result[second_chunk_start] & 0x0F, 5)  # isbn_count

    def test_invalid_isbns(self):
        """Test handling of invalid ISBNs."""
        record = create_record(
            oclc_number='123',
            holdings=1,
            isbns=['invalid1', 'invalid2', '9780000000014']
        )

        self.handler.process(record)
        result = self.handler.process({'metadata': {'oclc_number': None}})

        # Should only include the one valid ISBN
        self.assertEqual(result[0] & 0x0F, 1)  # isbn_count = 1

    def test_duplicate_isbns(self):
        """Test handling of duplicate ISBNs."""
        record = create_record(
            oclc_number='123',
            holdings=1,
            isbns=['9780000000014', '0000000016'],  # Both resolve to position 1
            isbn13='9780000000014'  # Another duplicate
        )

        self.handler.process(record)
        result = self.handler.process({'metadata': {'oclc_number': None}})

        # Should only include one position despite three ISBN inputs
        self.assertEqual(result[0] & 0x0F, 1)  # isbn_count = 1
        self.assertEqual(len(result), 6)  # 1 start byte + 4 bytes for ISBN position + 1 for holdings

if __name__ == '__main__':
    unittest.main()