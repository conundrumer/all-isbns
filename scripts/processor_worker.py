import json
from multiprocessing import Process, Queue, Event
import queue  # for queue exceptions
import io
import time
from typing import Optional
from dataclasses import dataclass

import zstandard

from processor_data_handler import DataHandler
from isbn_props_decoder import ISBNPropsDecoder
from processor_split_finder import SplitFinder

@dataclass
class ProgressUpdate:
    worker_id: int
    compressed_bytes: int
    uncompressed_bytes: int
    num_entries: int

class Worker:
    @staticmethod
    def run_worker(worker_id: int, start: tuple[int, str], end: tuple[int, str],
                  file_path: str, queue: Queue, progress_queue: Queue,
                  data_handler, stop_event: Event):
        """Static method to run as a separate process"""
        worker = Worker(worker_id, start, end, file_path, queue, progress_queue,
                       data_handler, stop_event)
        worker.run()

    def __init__(self, worker_id: int, start: tuple[int, str], end: tuple[int, str],
                 file_path: str, queue: Queue, progress_queue: Queue,
                 data_handler, stop_event: Event):
        self.worker_id = worker_id
        self.start_pos = start[0]
        self.start_id = start[1] if start[1] != '' else None
        self.end_pos = end[0]
        self.end_id = end[1] if end[1] != '' else None
        self.file_path = file_path
        self.queue = queue
        self.progress_queue = progress_queue
        self.data_handler = data_handler
        self.uncompressed_bytes = 0
        self.prev_fh_tell = None
        self.stop_event = stop_event
        self.num_entries = 0

        self.batch_size = 4 * 1024
        self.bytes_buffer = b''

    def run(self):
        with open(self.file_path, 'rb') as fh:
            fh.seek(self.start_pos)
            dctx = zstandard.ZstdDecompressor()
            reader = dctx.stream_reader(fh)
            text_stream = io.TextIOWrapper(reader, encoding='utf-8')

            hit_end_id = False

            try:
                while True:
                    if fh.tell() != self.prev_fh_tell:
                        if self.stop_event.is_set():
                            print(f"Worker {self.worker_id} stopping before read...")
                            break

                        self.prev_fh_tell = fh.tell()
                        compressed_pos = fh.tell() - self.start_pos
                        self.progress_queue.put(ProgressUpdate(
                            self.worker_id,
                            compressed_pos,
                            self.uncompressed_bytes,
                            self.num_entries
                        ))
                        self.num_entries = 0
                        self.uncompressed_bytes = 0

                    line = text_stream.readline()

                    if not line:
                        break

                    self.uncompressed_bytes += len(line)

                    if line.strip():
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError as e:
                            # we should not be expecting invalid JSON after reaching start_id
                            if self.start_id is None:
                                print(f"Warning: Worker {self.worker_id} encountered invalid JSON at position {self.uncompressed_bytes} {str(e)}")
                            continue
                        aacid = data.get('aacid')
                        if self.start_id is not None:
                            if aacid == self.start_id:
                                self.start_id = None
                            else:
                                continue

                        if self.end_id is not None and aacid == self.end_id:
                            hit_end_id = True
                            break

                        result = self.data_handler.process(data)
                        if result is not None:
                            self.bytes_buffer += result
                            self.num_entries += 1

                            if len(self.bytes_buffer) > self.batch_size:
                                while True:
                                    if self.stop_event.is_set():
                                        print(f"Worker {self.worker_id} stopping before put...")
                                        break
                                    try:
                                        self.queue.put(self.bytes_buffer, block=False)
                                        break
                                    except queue.Full:
                                        print('SLEEP')
                                        time.sleep(0.1)
                                        continue

                                self.bytes_buffer = b''

                    if hit_end_id:
                        break

                final_result = self.data_handler.process({})  # Empty dict to trigger flush
                if final_result is not None:
                    self.bytes_buffer += final_result
                    self.num_entries += 1

                self.queue.put(self.bytes_buffer)

                self.progress_queue.put(ProgressUpdate(
                    self.worker_id,
                    compressed_pos,
                    self.uncompressed_bytes,
                    self.num_entries
                ))

            finally:
                if self.stop_event.is_set():
                    print(f"Worker {self.worker_id} cleanup after stop signal")
                reader.close()

if __name__ == "__main__":
    def process_file(file_path: str, num_workers: Optional[int] = None):
        if num_workers is None:
            num_workers = 4

        # Find split points
        finder = SplitFinder(file_path)
        split_points = finder.find_split_points(num_workers)

        # Create queues
        result_queue = Queue()
        progress_queue = Queue()
        stop_event = Event()

        # Create and start workers
        workers = []
        decoder = ISBNPropsDecoder()

        for i in range(num_workers):
            start = split_points[i-1] if i > 0 else (0, '')
            end = split_points[i] if i < len(split_points) else (finder.file_size + 1, '')
            worker = Process(
                target=Worker.run_worker,
                args=(
                    i,
                    start,
                    end,
                    file_path,
                    result_queue,
                    progress_queue,
                    DataHandler(),
                    stop_event
                )
            )
            workers.append(worker)
            worker.start()

        # Monitor progress
        try:
            while any(worker.is_alive() for worker in workers):
                try:
                    progress = progress_queue.get(timeout=1.0)
                    worker = workers[progress.worker_id]
                    print(f"Worker {progress.worker_id}: "
                          f"{progress.compressed_bytes} compressed bytes processed")
                except (EOFError, queue.Empty):
                    continue
        except KeyboardInterrupt:
            print("\nStopping workers...")
            stop_event.set()

        # Process and print results
        counter = 0
        while not result_queue.empty():
            try:
                encoded_record = result_queue.get_nowait()
                print(len(encoded_record))
                if encoded_record is None:
                    break

                # Decode and print each record
                for record in decoder.decode_bytes(encoded_record):
                    print(f"Record {counter}:")
                    print(f"  Holdings: {record.holdings_count}")
                    print(f"  Year: {record.year}")
                    print(f"  ISBN positions: {record.isbn_positions}")
                    print()
                    counter += 1
            except EOFError:
                break

        print(f"Total records processed: {counter}")

        # Wait for all workers to finish
        for worker in workers:
            worker.join(timeout=1.0)
            if worker.is_alive():
                worker.terminate()

    process_file('data/annas_archive_meta__aacid__worldcat__20231001T025039Z--20231001T235839Z.jsonl.seekable.zst', 3)