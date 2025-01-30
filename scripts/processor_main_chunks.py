import argparse
import os
import sys
import signal
import time
import threading
from typing import Optional, Tuple
from multiprocessing import Pool, Queue, Event, cpu_count, Manager
import queue  # for queue exceptions
from tqdm import tqdm
from processor_worker import Worker, ProgressUpdate, DataHandler, SplitFinder

def worker_task(args: Tuple):
    """Worker function that processes a chunk of the file"""
    worker_id, start, end, input_path, result_queue, progress_queue, data_handler, stop_event = args
    Worker.run_worker(
        worker_id,
        start,
        end,
        input_path,
        result_queue,
        progress_queue,
        data_handler,
        stop_event
    )

def process_file(input_path: str, output_path: str, num_workers: Optional[int] = None, num_chunks: Optional[int] = None):
    if num_workers is None:
        num_workers = cpu_count()
    if num_chunks is None:
        num_chunks = num_workers

    # Calculate total file size for progress bar
    total_size = os.path.getsize(input_path)

    print(f"\nStarting processing with {num_workers} workers and {num_chunks} chunks:")
    print(f"Input file:  {input_path}")
    print(f"Output file: {output_path}")
    print(f"Input size:  {total_size:,} bytes")

    # Create output directory if it doesn't exist
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Find split points
    finder = SplitFinder(input_path)
    split_points = finder.find_split_points(num_chunks)

    # Create shared queues and event using Manager
    manager = Manager()
    result_queue = manager.Queue()
    progress_queue = manager.Queue()
    stop_event = manager.Event()

    # Set up signal handlers
    def signal_handler(signum, frame):
        """Handle interrupt by stopping workers and cleaning up resources."""
        print("\nReceived signal to terminate. Cleaning up...")
        stop_event.set()
        if 'pool' in globals():
            pool.terminate()
            pool.join()
        sys.exit(1)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Prepare worker arguments
    worker_args = []
    for i in range(num_chunks):
        start = split_points[i-1] if i > 0 else (0, '')
        end = split_points[i] if i < len(split_points) else (finder.file_size + 1, '')
        args = (
            i,
            start,
            end,
            input_path,
            result_queue,
            progress_queue,
            DataHandler(),
            stop_event
        )
        worker_args.append(args)

    # Initialize progress tracking
    progress = {i: 0 for i in range(num_chunks)}
    pbar = tqdm(total=total_size, unit='B', unit_scale=True)

    # Start result writer thread
    result_writer = threading.Thread(
        target=write_results,
        args=(result_queue, output_path)
    )
    result_writer.start()

    # Create and start the pool
    pool = Pool(processes=num_workers)
    async_result = pool.map_async(worker_task, worker_args)

    # Monitor progress
    total_uncompressed = 0
    total_results = 0

    while not async_result.ready():
        try:
            update: ProgressUpdate = progress_queue.get(timeout=0.1)
        except (EOFError, queue.Empty):
            continue

        if update is None:
            continue

        worker_start = split_points[update.worker_id-1][0] if update.worker_id > 0 else 0
        worker_end = split_points[update.worker_id][0] if update.worker_id < len(split_points) else total_size

        # Cap progress at worker's assigned range
        new_progress = min(update.compressed_bytes, worker_end - worker_start)
        old_progress = progress[update.worker_id]
        progress[update.worker_id] = new_progress

        pbar.update(new_progress - old_progress)

        total_uncompressed += update.uncompressed_bytes
        total_results += update.num_entries

    pbar.close()

    # Clean up
    pool.close()
    pool.join()

    result_queue.put(None)  # Signal writer to stop
    result_writer.join()

    # Print completion statistics
    print("\nProcessing complete!")
    print(f"Uncompressed data processed: {total_uncompressed:,} bytes")
    print(f"Total results: {total_results:,}")

def write_results(queue: Queue, output_path: str):
    """Write results to output file as they come in."""
    f = None
    try:
        f = open(output_path, 'wb')
        while True:
            try:
                result = queue.get()
                if result is None:
                    break
                f.write(result)
                f.flush()
            except EOFError:
                break
            except KeyboardInterrupt:
                # On interrupt, make sure we flush and exit cleanly
                if f is not None:
                    f.flush()
                break
    finally:
        if f is not None:
            f.flush()
            f.close()

def main():
    parser = argparse.ArgumentParser(description='Process a file using multiple workers')
    parser.add_argument('input_path', help='Path to input file')
    parser.add_argument('output_path', help='Path to write output file')
    parser.add_argument('--workers', type=int, help='Number of worker processes (default: CPU count)')
    parser.add_argument('--chunks', type=int, help='Number of chunks to split the file into (default: same as workers)')

    args = parser.parse_args()

    try:
        process_file(args.input_path, args.output_path, args.workers, args.chunks)
    except KeyboardInterrupt:
        print("\nReceived interrupt signal. Shutting down gracefully...")
        sys.exit(1)

if __name__ == "__main__":
    main()