import zstandard as zstd
import json
import io
from typing import Optional

class SplitValidator:
    """Determines if two consecutive JSONs make a valid split point"""

    def is_valid_split(self, json_before: dict, json_after: dict) -> bool:
        """
        Determines if it's safe to split between these two JSONs.
        """
        return json_before.get('metadata').get('oclc_number') != json_after.get('metadata').get('oclc_number')

class SplitFinder:
    def __init__(self, filepath: str, validator: Optional[SplitValidator] = None):
        self.filepath = filepath
        self.validator = validator or SplitValidator()
        self.file_size = 0

        # Initialize file size
        with open(filepath, 'rb') as f:
            f.seek(0, 2)  # Seek to end
            self.file_size = f.tell()

    def _find_next_frame(self, fh) -> Optional[int]:
        """Find next Zstandard frame from current position"""
        while True:
            chunk = fh.read(4096)
            if not chunk:
                return None

            magic_pos = chunk.find(zstd.FRAME_HEADER)
            if magic_pos != -1:
                # Return absolute position of frame start
                return fh.tell() - len(chunk) + magic_pos

            if fh.tell() == self.file_size:
                return None

            # Back up a few bytes in case magic number spans chunks
            fh.seek(-4, 1)  # 1 means relative to current position

    def _read_jsons_at_position(self, position: int):
        """Read num_jsons complete JSON objects starting at position"""
        with open(self.filepath, 'rb') as fh:
            fh.seek(position)

            # Initialize decompressor for this position
            dctx = zstd.ZstdDecompressor()
            reader = dctx.stream_reader(fh)
            text_stream = io.TextIOWrapper(reader, encoding='utf-8')

            jsons = []

            try:
                while True:
                    try:
                        line = text_stream.readline()
                    except UnicodeDecodeError:
                        # ignore split unicode chars
                        # print('UnicodeDecodeError')
                        continue

                    if not line:
                        break

                    if line.strip():
                        try:
                            yield json.loads(line)
                            # jsons.append(json.loads(line))
                            # if len(jsons) >= num_jsons:
                            #     break
                        except json.JSONDecodeError:
                            continue

            finally:
                # buffer.close()
                reader.close()

            return jsons

    def find_split_points(self, num_splits: int) -> list[tuple[int, str]]:
        """
        Find appropriate split points for parallel processing.
        Returns list of byte offsets and json aacid where splitting is valid.
        """
        if num_splits <= 1:
            return []

        splits = []
        target_percentages = [
            i / num_splits
            for i in range(1, num_splits)
        ]

        splits = []
        for percentage in target_percentages:
            target_byte = int(percentage * self.file_size)

            # Keep searching until we find a valid split point
            current_pos = target_byte
            while True:
                with open(self.filepath, 'rb') as fh:
                    fh.seek(current_pos)
                    frame_pos = self._find_next_frame(fh)

                if frame_pos is None:
                    raise RuntimeError(f"Could not find valid split point for percentage {percentage}")

                # jsons = self._read_jsons_at_position(frame_pos, num_jsons=100)
                # if len(jsons) < 2:
                #     print("NOT ENOUGH JSONS")
                #     current_pos = frame_pos + 1
                #     continue

                should_break = False
                prev_json = None
                # for i in range(len(jsons) - 1):
                for curr_json in self._read_jsons_at_position(frame_pos):
                    if prev_json is None:
                        prev_json = curr_json
                        continue

                    if self.validator.is_valid_split(prev_json, curr_json):
                        splits.append((frame_pos, curr_json.get('aacid')))
                        should_break = True
                        break

                    prev_json = curr_json

                if should_break:
                    break

                current_pos = frame_pos + 1

        return splits

# Example usage:
if __name__ == "__main__":
    # finder = SplitFinder('data/annas_archive_meta__aacid__worldcat__20231001T025039Z--20231001T235839Z.jsonl.seekable.zst')
    finder = SplitFinder('data/annas_archive_meta__aacid__worldcat__20241230T203056Z--20241230T203056Z.jsonl.seekable.zst')
    split_points = finder.find_split_points(100)

    print(split_points)