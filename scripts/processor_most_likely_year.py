import re
from collections import Counter

def extract_most_likely_year(strings: list[str]) -> int | None:
    """
    Extract most likely publication year using frequency and year proximity:
    1. Most frequent year wins
    2. For ties:
        - If years are close (within 5 years), pick earlier year
        - If years are far apart, pick more recent year
    """
    current_year = 2025
    years = []

    # Extract all valid years that are bounded by non-digits or string boundaries
    for text in strings:
        matches = re.finditer(r'(?:^|[^\d])(\d{4})(?:[^\d]|$)', str(text))
        for match in matches:
            year = int(match.group(1))  # group(1) gets the digits inside the boundaries
            if 1450 <= year <= current_year:
                years.append(year)

    if not years:
        return None

    # Get frequencies
    counts = Counter(years)
    max_count = max(counts.values())
    candidates = [year for year, count in counts.items() if count == max_count]

    if len(candidates) == 1:
        return candidates[0]

    # Multiple years with same frequency - use proximity logic
    candidates.sort()

    # If any candidates are within 5 years, take the earlier one
    for i in range(len(candidates) - 1):
        if candidates[i+1] - candidates[i] <= 5:
            return candidates[i]

    # Otherwise take the most recent candidate
    return candidates[-1]

import unittest

class TestYearExtraction(unittest.TestCase):
    def setUp(self):
        self.extract = extract_most_likely_year

    def test_basic_cases(self):
        """Test single year and empty cases"""
        self.assertEqual(self.extract(["1966"]), 1966)
        self.assertEqual(self.extract([]), None)
        self.assertEqual(self.extract(["no years here"]), None)
        self.assertEqual(self.extract(["123"]), None)  # too short
        self.assertEqual(self.extract(["12345"]), None)  # too long

    def test_invalid_years(self):
        """Test years outside valid range"""
        self.assertEqual(self.extract(["1449"]), None)  # too early
        self.assertEqual(self.extract(["2026"]), None)  # future
        self.assertEqual(self.extract(["1449", "1966"]), 1966)  # should pick valid year

    def test_frequency_priority(self):
        """Test that most frequent year wins"""
        self.assertEqual(self.extract(["1966", "1966", "1967"]), 1966)
        self.assertEqual(self.extract(["1966", "1967", "1967"]), 1967)
        self.assertEqual(self.extract(["1555", "1555", "1966"]), 1555)

    def test_close_years_tiebreaker(self):
        """Test handling of years close together"""
        self.assertEqual(self.extract(["1966", "1967"]), 1966)  # close, pick earlier
        self.assertEqual(self.extract(["1966", "1966", "1967", "1967"]), 1966)
        self.assertEqual(self.extract(["1965", "1966", "1967"]), 1965)

    def test_distant_years_tiebreaker(self):
        """Test handling of years far apart"""
        self.assertEqual(self.extract(["1555", "1966"]), 1966)  # far, pick recent
        self.assertEqual(self.extract(["1555", "1555", "1966", "1966"]), 1966)

    def test_mixed_scenarios(self):
        """Test complex cases with multiple rules interacting"""
        # Frequency wins over proximity
        self.assertEqual(self.extract(["1966", "1966", "1967", "1968"]), 1966)

        # Equal frequency, then proximity rules
        self.assertEqual(self.extract(["1555", "1555", "1966", "1967"]), 1555)

        # Multiple year mentions in same string
        self.assertEqual(self.extract(["1966-1967", "1966"]), 1966)

        # Years with surrounding text
        self.assertEqual(self.extract(["Published in 1966", "Copyright 1966", "1967"]), 1966)

    def test_robustness(self):
        """Test handling of messy input"""
        self.assertEqual(self.extract(["1966.1555"]), 1966)
        self.assertEqual(self.extract(["1966_1555"]), 1966)
        self.assertEqual(self.extract(["1966-1967"]), 1966)
        self.assertEqual(self.extract([None, "", "1966"]), 1966)
        self.assertEqual(self.extract([123, "1966"]), 1966)  # non-string input
        self.assertEqual(self.extract(["19661967"]), None)  # no match for 8 digits
        self.assertEqual(self.extract([None, ""]), None)


if __name__ == '__main__':
    unittest.main()