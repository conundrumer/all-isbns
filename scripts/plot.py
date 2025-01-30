from pathlib import Path
from PIL import Image
from common import HEIGHT, WIDTH, get_pos


def get_plot_pos(isbn: str) -> tuple[int, int]:
    x, y = get_pos(isbn)
    w, h = get_pos('00' + '0' * (len(isbn) - 4) + '11')

    return x // w, y // h

def init_plots():
    image_dims = [(WIDTH // 10 ** ((i + 2) // 2), HEIGHT // 10 ** ((i + 1) // 2)) for i in range(6)]
    image_dims.reverse()

    return [Image.new('1', (w, h)) for w, h in image_dims]

def save_plots(images: list[Image.Image], output_path: Path):
    for i, image in enumerate(images):
        # for better PNG compression, store in landscape orientation
        rotated = i % 2 == 1
        if rotated:
            image = image.transpose(Image.Transpose.ROTATE_90)
        image.save(output_path / f"{i}{'r' if rotated else ''}.png")
