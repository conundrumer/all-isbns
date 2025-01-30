#!/usr/bin/env python3
import os
import json
import sys
from pathlib import Path
from typing import Dict, List

def get_directory_files(directory: str) -> List[str]:
    """
    Get all filenames in a directory excluding those starting with a dot.
    Returns filenames without extensions.
    """
    files = []
    for entry in os.scandir(directory):
        if not entry.name.startswith('.'):
            # Get filename without extension
            filename = os.path.splitext(entry.name)[0]
            files.append(filename)
    return sorted(files)

def create_manifest_json(paths: List[str]) -> Dict[str, List[str]]:
    """
    Create a JSON structure mapping directory names to their file contents.
    For directory inputs, uses the directory name as key.
    For file inputs, uses the parent directory name as key.
    """
    result = {}

    for path in paths:
        path_obj = Path(path)

        if path_obj.is_dir():
            dir_name = path_obj.name
            directory = path_obj
        else:
            dir_name = path_obj.parent.name
            directory = path_obj.parent

        files = get_directory_files(directory)
        result[dir_name] = files

    return result

def main():
    if len(sys.argv) < 2:
        print("Usage: script.py <path1> <path2> ...", file=sys.stderr)
        print("Paths can be either directories or files", file=sys.stderr)
        sys.exit(1)

    paths = sys.argv[1:]
    manifest_json = create_manifest_json(paths)

    print(json.dumps(manifest_json, separators=(',', ':'), ensure_ascii=False))

if __name__ == "__main__":
    main()