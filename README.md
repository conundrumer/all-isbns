# Setup

1. Install requirements.txt
2. If you're not using uv, edit the first line in the Makefile `PYTHON := uv run` to your choice of Python
3. Add data files to the `data` dir, see the Makefile
4. Run `make`. May take 1-2 hours to complete if using full sized worldcat dataset. You can build each target separately and exit early to speed things up.
5. Run an http server in `web` like `python -m http.server` or `npx reload`

# other notes

Note that ISBN prefixes 978- and 979- are replaced with 0 and 1

divisions and reduction factors:

- tile sets: [(1, 50), (2, 25), (5, 10), (10, 5), (20, 1)]
- tile props: [(1, 50), (2, 25), (5, 10), (10, 5), (20, 2), (50, 1)]
