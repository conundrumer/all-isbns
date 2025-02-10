PYTHON := uv run

# Directories
SCRIPTS := scripts
INPUT_DATA := data
WEB_DIR := web

# Input files
# get this from here, "Range Message (xml) Generate": https://www.isbn-international.org/range_file_generation
RANGE_MSG := $(INPUT_DATA)/RangeMessage.xml
# get these from AA
ISBNGRP := $(INPUT_DATA)/annas_archive_meta__aacid__isbngrp_records__20240920T194930Z--20240920T194930Z.jsonl.seekable.zst
ISBN_CODES := $(INPUT_DATA)/aa_isbn13_codes_20250111T024210Z.benc.zst
WORLDCAT := $(INPUT_DATA)/annas_archive_meta__aacid__worldcat__20241230T203056Z--20241230T203056Z.jsonl.seekable.zst

# Output directories
OUTPUT := $(WEB_DIR)/data
INTERMEDIATE := intermediate

# Generated web data
ISBN_AGENCIES := $(OUTPUT)/isbn_agencies.json
ISBN_PUBLISHERS := $(OUTPUT)/isbn_publishers/.sentinel
AGENCY_PLOT := $(OUTPUT)/agency_plot.png
PUBLISHER_PLOTS := $(OUTPUT)/publisher_plots/.sentinel
ALLOCATION_PLOTS := $(OUTPUT)/allocation_plots/.sentinel
TILE_SETS := $(OUTPUT)/tile_sets/.sentinel
TILE_PROPS := $(OUTPUT)/tile_props/.sentinel
MANIFEST_JSON := $(OUTPUT)/manifest.json

# Intermediate files
ISBN_PROPS_DATA := $(INTERMEDIATE)/isbn_props_data
PUBLISHER_ISBN_LIST := $(INTERMEDIATE)/publisher_isbns.txt

.PHONY: all clean setup web-data

all: web-data

setup:
	uv venv
# 	uv pip install -r requirements.txt

# Create necessary directories
$(OUTPUT) $(INTERMEDIATE):
	@mkdir -p $@

$(ISBN_AGENCIES): $(RANGE_MSG) $(SCRIPTS)/extract_agencies.py | $(OUTPUT)
	$(PYTHON) $(SCRIPTS)/extract_agencies.py $< $@

$(ISBN_PUBLISHERS): $(ISBNGRP) $(SCRIPTS)/extract_publishers.py | $(OUTPUT) $(INTERMEDIATE)
	rm -rf $(@D)
	@mkdir -p $(@D)
	$(PYTHON) $(SCRIPTS)/extract_publishers.py $< $(@D) $(PUBLISHER_ISBN_LIST)
	@touch $@

$(AGENCY_PLOT): $(ISBN_AGENCIES) $(SCRIPTS)/plot_agencies.py | $(OUTPUT)
	$(PYTHON) $(SCRIPTS)/plot_agencies.py $< $@

$(PUBLISHER_PLOTS): $(ISBN_PUBLISHERS) $(SCRIPTS)/plot_publishers.py | $(OUTPUT)
	rm -rf $(@D)
	@mkdir -p $(@D)
	$(PYTHON) $(SCRIPTS)/plot_publishers.py $(PUBLISHER_ISBN_LIST) $(@D)
	@touch $@

$(ALLOCATION_PLOTS): $(RANGE_MSG) $(SCRIPTS)/plot_allocations.py | $(OUTPUT)
	rm -rf $(@D)
	@mkdir -p $(@D)
	$(PYTHON) $(SCRIPTS)/plot_allocations.py $< $(@D)
	@touch $@

$(ISBN_PROPS_DATA): $(WORLDCAT) $(SCRIPTS)/processor_*.py | $(INTERMEDIATE)
	$(PYTHON) $(SCRIPTS)/processor_main.py $< $@.tmp
	@mv $@.tmp $@

$(TILE_SETS): $(ISBN_CODES) $(SCRIPTS)/render_tile_sets.py | $(OUTPUT)
	rm -rf $(@D)
	@mkdir -p $(@D)
	$(PYTHON) $(SCRIPTS)/render_tile_sets.py $< $(@D)
	@touch $@

$(TILE_PROPS): $(ISBN_PROPS_DATA) $(ISBN_CODES) $(SCRIPTS)/render_tile_props.py | $(OUTPUT)
	rm -rf $(@D)
	@mkdir -p $(@D)
	$(PYTHON) $(SCRIPTS)/render_tile_props.py $< $(@D) --isbncodes $(ISBN_CODES)
	@touch $@

$(MANIFEST_JSON): $(ISBN_AGENCIES) $(ISBN_PUBLISHERS) $(PUBLISHER_PLOTS) $(ALLOCATION_PLOTS) $(TILE_SETS) $(TILE_PROPS) $(SCRIPTS)/create_manifest.py | $(OUTPUT)
	$(PYTHON) $(SCRIPTS)/create_manifest.py $(ISBN_PUBLISHERS) $(PUBLISHER_PLOTS) $(ALLOCATION_PLOTS) $(TILE_SETS) $(TILE_PROPS) > $@

web-data: $(MANIFEST_JSON)

# Clean created files
clean:
	rm -rf $(INTERMEDIATE)
	rm -rf $(OUTPUT)

