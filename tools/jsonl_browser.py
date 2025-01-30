#!/usr/bin/env python3
import argparse
import json
import os
import sys
from typing import Optional, Dict
import zstandard as zstd
from rich.console import Console
from rich.syntax import Syntax
from rich.prompt import Prompt
from rich.panel import Panel
from rich.table import Table
import io

class JsonlBrowser:
    def __init__(self, filepath: str, cache_size: int = 1000):
        self.filepath = filepath
        self.console = Console()
        self.current_position = 0
        self.cache_size = cache_size
        self.cache: Dict[int, dict] = {}
        self.file_size = os.path.getsize(self.filepath)

        # Open the file for reading
        self.fh = open(self.filepath, 'rb')

        # Initialize decompressor with seeking capabilities
        self.dctx = zstd.ZstdDecompressor()
        self.reader = self.dctx.stream_reader(self.fh)

        # Reset to start
        self.fh.seek(0)
        self.buffer = io.StringIO()

        # Load initial entries into cache
        self._fill_cache()

    def _seek_to_percentage(self, percentage: float) -> Optional[int]:
        """
        Seek to approximate percentage position using zstd frame info.
        Returns the closest entry position if successful, None otherwise.
        """
        if not 0 <= percentage <= 100:
            return None

        target_byte = int((percentage / 100.0) * self.file_size)

        try:
            # Seek to nearest frame boundary
            self.fh.seek(target_byte)
            # Find next frame header
            while True:
                chunk = self.fh.read(4096)
                if not chunk:
                    break

                # Look for frame magic number (0xFD2FB528)
                magic_pos = chunk.find(b'\x28\xB5\x2F\xFD')
                if magic_pos != -1:
                    # Seek back to frame start
                    self.fh.seek(self.fh.tell() - len(chunk) + magic_pos)
                    break

            # Reset reader and cache at new position
            self.reader = self.dctx.stream_reader(self.fh)
            self.cache.clear()
            self.buffer = io.StringIO()

            # Read one batch to establish new position
            self._fill_cache()
            if self.cache:
                return min(self.cache.keys())

        except Exception as e:
            self.console.print(f"[red]Error during seek: {str(e)}[/red]")

        return None

    def _fill_cache(self):
        """Fill cache with next batch of entries."""
        try:
            while len(self.cache) < self.cache_size:
                chunk = self.reader.read(8192)
                if not chunk:
                    break

                text = chunk.decode('utf-8')
                self.buffer.write(text)
                self.buffer.seek(0)

                lines = self.buffer.readlines()
                if text and not text.endswith('\n'):
                    last_line = lines.pop()
                    self.buffer = io.StringIO(last_line)
                else:
                    self.buffer = io.StringIO()

                start_pos = max(self.cache.keys(), default=-1) + 1
                for i, line in enumerate(lines):
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            self.cache[start_pos + i] = entry
                        except json.JSONDecodeError:
                            self.console.print(f"[red]Error decoding JSON at position {start_pos + i}[/red]")

        except Exception as e:
            self.console.print(f"[red]Error reading file: {str(e)}[/red]")

    def _get_entry(self, position: int) -> Optional[dict]:
        """Get entry at specified position."""
        if position < 0:
            return None

        if position in self.cache:
            return self.cache[position]

        if position > max(self.cache.keys(), default=-1):
            self._fill_cache()
            return self.cache.get(position)

        return None

    def display_entry(self, entry: dict):
        """Display a JSON entry with syntax highlighting."""
        json_str = json.dumps(entry, indent=2)
        syntax = Syntax(json_str, "json", theme="monokai")
        self.console.print(Panel(syntax))

    def display_stats(self):
        """Display file statistics."""
        table = Table(title="File Statistics")
        table.add_column("Metric")
        table.add_column("Value")

        table.add_row("File Size", f"{self.file_size:,} bytes")
        table.add_row("Current Position", str(self.current_position))
        table.add_row("Cached Entries", str(len(self.cache)))

        # Add approximate percentage through file
        if self.file_size > 0:
            current_byte = self.fh.tell()
            percentage = (current_byte / self.file_size) * 100
            table.add_row("Approximate Position", f"{percentage:.6f}%")

        self.console.print(table)

    def search(self, query: str):
        """Search for entries containing the query string."""
        results = []

        # Search in cache
        for pos, entry in self.cache.items():
            if any(query.lower() in str(v).lower() for v in entry.values()):
                results.append((pos, entry))

        if results:
            table = Table(title=f"Search Results for '{query}' (from cache)")
            table.add_column("Position")
            table.add_column("Preview")

            for pos, entry in results:
                preview = str(entry)[:100] + "..." if len(str(entry)) > 100 else str(entry)
                table.add_row(str(pos), preview)

            self.console.print(table)

            if Prompt.ask("Jump to result?", choices=["y", "n"], default="n") == "y":
                try:
                    pos = int(Prompt.ask("Enter position"))
                    if pos in [p for p, _ in results]:
                        self.current_position = pos
                    else:
                        self.console.print("[red]Invalid position[/red]")
                except ValueError:
                    self.console.print("[red]Invalid position[/red]")
        else:
            self.console.print("[yellow]No results found in cache. Full file search not implemented.[/yellow]")

    def run(self):
        """Main interactive loop."""
        try:
            while True:
                self.console.clear()
                entry = self._get_entry(self.current_position)

                if entry:
                    self.display_entry(entry)
                else:
                    self.console.print("[red]No more entries[/red]")

                self.display_stats()

                command = Prompt.ask(
                    "\nCommands",
                    choices=["n", "p", "j", "s", "q", "%"],  # Added '%' command
                    default="n"
                )

                if command == "%":  # percentage jump
                    try:
                        percentage = float(Prompt.ask("Enter percentage (0-100)"))
                        new_pos = self._seek_to_percentage(percentage)
                        if new_pos is not None:
                            self.current_position = new_pos
                        else:
                            self.console.print("[red]Invalid percentage or seek failed[/red]")
                    except ValueError:
                        self.console.print("[red]Invalid percentage[/red]")
                elif command == "n":
                    self.current_position += 1
                elif command == "p":
                    self.current_position = max(0, self.current_position - 1)
                elif command == "j":
                    try:
                        pos = int(Prompt.ask("Jump to position"))
                        self.current_position = max(0, pos)
                    except ValueError:
                        self.console.print("[red]Invalid position[/red]")
                elif command == "s":
                    query = Prompt.ask("Enter search term")
                    self.search(query)
                elif command == "q":
                    break

        finally:
            self.buffer.close()
            self.reader.close()
            self.fh.close()


def main():
    parser = argparse.ArgumentParser(description="Browse a JSONL Zstandard file")
    parser.add_argument("file", help="Path to the .jsonl.zst file")
    parser.add_argument("--cache-size", type=int, default=1000,
                      help="Number of entries to keep in cache (default: 1000)")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"Error: File '{args.file}' not found")
        sys.exit(1)

    browser = JsonlBrowser(args.file, args.cache_size)
    browser.run()


if __name__ == "__main__":
    main()