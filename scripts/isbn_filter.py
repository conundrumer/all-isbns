def filter_invalid_isbns(isbns):
    """
    Filter out invalid ISBNs based on prefix/base relationships.
    """
    # Find ISBN-10s and their bases
    isbn10s = {isbn for isbn in isbns if len(isbn) == 10}
    bases = {isbn[:9] for isbn in isbn10s}

    # Find valid ISBN-13s that correspond to ISBN-10 bases
    valid_isbn13s = {
        isbn13 for isbn13 in isbns
        if len(isbn13) == 13
        and any(isbn13.startswith('978' + base) for base in bases)
    }

    # Remove ISBN-13s that improperly start with a known base
    remaining_isbn13s = {
        isbn13 for isbn13 in isbns
        if len(isbn13) == 13
        and isbn13 not in valid_isbn13s
        and not any(isbn13.startswith(base) for base in bases)
    }

    # Find ISBN-13s that start with 978
    isbns_978 = {
        isbn13 for isbn13 in remaining_isbn13s
        if isbn13.startswith('978')
    }

    # add to bases
    bases |= {isbn13[3:12] for isbn13 in isbns_978}

    # Remove ISBN-13s that improperly start with a known base (again)
    remaining_isbn13s = {
        isbn13 for isbn13 in remaining_isbn13s
        if not any(isbn13.startswith(base) for base in bases)
    }

    # Find ISBN-13s that start with 979 and aren't a duplicate
    isbns_979 = {
        isbn13 for isbn13 in remaining_isbn13s
        if isbn13 not in isbns_978
        and not any(isbn13.startswith('979' + base) for base in bases)
    }

    # Combine valid ISBNs
    return isbn10s | valid_isbn13s | isbns_978 | isbns_979


import unittest

class TestISBNValidator(unittest.TestCase):
    def test_base_979(self):
        """Test handling of base starting with 979"""
        isbns = ['9790900007704', '9789790900004', '9790900007', '9790900007704']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, {'9789790900004', '9790900007'})

    def test_base_968(self):
        """Test handling of regular base with both ISBN-10 and ISBN-13"""
        isbns = ['9789686708578', '9799686708577', '968670857X', '9789686708578']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, {'968670857X', '9789686708578'})

    def test_no_errors(self):
        """Test handling of valid ISBN set"""
        isbns = ['968670857X', '9789686708578']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, set(isbns))

    def test_base_978(self):
        """Test handling of base starting with 978"""
        isbns = ['9789781234567', '9781234567897', '9781234567']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, {'9781234567', '9789781234567'})

    @unittest.skip("Undecided how to handle conflicting 978/979 prefixes without ISBN-10")
    def test_conflicting_prefixes(self):
        """Test handling of same base with different prefixes"""
        isbns = ['9780001230005', '9790001230005']
        result = filter_invalid_isbns(isbns)
        # We don't know which one to keep yet
        self.fail("Not implemented")

    def test_empty_input(self):
        """Test handling of empty input"""
        self.assertEqual(filter_invalid_isbns(set()), set())

    def test_single_isbn10(self):
        """Test handling of single ISBN-10"""
        isbns = ['968670857X']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, set(isbns))

    def test_single_979(self):
        isbns = ['9791036501005']
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, set(isbns))

    def test_mixed_valid_invalid(self):
        """Test handling of mixed valid and invalid ISBNs"""
        isbns = [
            '968670857X',  # valid ISBN-10
            '9789686708578',  # valid ISBN-13 matching ISBN-10
            '9799686708577',  # invalid ISBN-13 (wrong prefix)
            '9790900007704',  # invalid (starts with base)
            '9789790900004'   # valid ISBN-13
        ]
        result = filter_invalid_isbns(isbns)
        self.assertEqual(result, {'968670857X', '9789686708578', '9789790900004'})


if __name__ == '__main__':
    unittest.main()