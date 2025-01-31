import ViewportController from "./ViewportController.js";

import { screenToContent } from "./Transform.js";

/**
 * @typedef {Object} Layer
 * @property {number} id
 * @property {boolean} visible
 * @property {string} color
 * @property {string} dataset
 * @property {string} mode
 * @property {number} cutoff
 * @property {number} lowerCutoff
 * @export
 */
const BLOCK_SIZE = 10_000;
const CONTENT_WIDTH = 50_000;
const CONTENT_HEIGHT = 40_000;
const PLOT_WIDTH = 5_000;
const PLOT_HEIGHT = 40_000;
const MIN_SCALE = 5e-3;
const MAX_SCALE = 5e2;

const COLOR_RANGE_AGENCY = "rgb(3, 8, 7)";
const COLOR_RANGE_ALLOCATION = "rgb(8, 13, 14)";
const COLOR_RANGE_PUBLISHER = "rgb(15, 25, 32)";

const DATASET_BRIGHTNESS_FLOOR = 0.1;
const PROPS_BRIGHTNESS_FLOOR = 0.2;

const DATASET_SCALES = [
  { d: 1, s: 50 }, // 0.02
  { d: 2, s: 25 }, // 0.04
  { d: 5, s: 10 }, // 0.1
  { d: 10, s: 5 }, // 0.2
  { d: 20, s: 1 }, // 1
];
// console.log(
//   DATASET_SCALES.map(({d,s})=>
//     10_000 / d / s
//   )
// )
const PROPS_SCALES = [
  { d: 1, s: 50 }, // 0.02
  { d: 2, s: 25 }, // 0.04
  { d: 5, s: 10 }, // 0.1
  { d: 10, s: 5 }, // 0.2
  { d: 20, s: 2 }, // 0.5
  { d: 50, s: 1 }, // 1
];

const filterThreshold = (threshold = 1) =>
  threshold < 127
    ? `invert(1) brightness(${
        (0.5 / (1 - threshold / 255)) * 100
      }%) contrast(255) invert(1)`
    : `brightness(${
        (0.5 / (1 - (255 - threshold) / 255)) * 100
      }%) contrast(255)`;

/**
 * @param {number} s
 * @param {{d: number, s: number}[]} scales
 * @return {{d: number, s: number}}
 */
// const getClosestScale = (s, scales) => {
//   let index = 0;
//   scales.forEach((scale, i) => {
//     if (s * scale.s >= 1) {
//       index = i;
//     }
//   })
//   return scales[Math.min(scales.length - 1, index + 1)];
// }
const getClosestScale = (x, scales) =>
  scales.reduce(
    ([prevScale, prevDistance], scale) => {
      const distance = Math.abs(1 - x * scale.s);
      // const distance = Math.abs(Math.log(x * scale.s));
      return distance < prevDistance
        ? [scale, distance]
        : [prevScale, prevDistance];
    },
    [{ d: 0, s: 0 }, Infinity]
  )[0];

// const toBlockCoords = ([x, y]) => {
//   let bx = Math.max(0, Math.min(4, Math.floor(x / BLOCK_SIZE)));
//   let by = Math.max(0, Math.min(3, Math.floor(y / BLOCK_SIZE)));

//   if (by % 2 === 1) {
//     bx += 5;
//   }
//   by = (by / 2) | 0;

//   return [bx, by];
// };
const toBlockId = ({ bx, by }) => [(by / 2) | 0, bx + (by % 2) * 5];
function* rangeBlockCoords(x0, y0, x1, y1) {
  const bx0 = Math.max(0, Math.min(4, Math.floor(x0 / BLOCK_SIZE)));
  const by0 = Math.max(0, Math.min(3, Math.floor(y0 / BLOCK_SIZE)));
  const bx1 = Math.max(0, Math.min(4, Math.floor(x1 / BLOCK_SIZE)));
  const by1 = Math.max(0, Math.min(3, Math.floor(y1 / BLOCK_SIZE)));

  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      yield {
        bx: bx,
        by: by,
        x0: Math.max(0, x0 - bx * BLOCK_SIZE),
        y0: Math.max(0, y0 - by * BLOCK_SIZE),
        x1: Math.min(BLOCK_SIZE, x1 - bx * BLOCK_SIZE),
        y1: Math.min(BLOCK_SIZE, y1 - by * BLOCK_SIZE),
      };
    }
  }
}

function* rangeTiles(blockCoords, { d, s }) {
  const blockId = toBlockId(blockCoords).join("");
  const { bx, by, x0, y0, x1, y1 } = blockCoords;
  const tx0 = Math.max(0, Math.floor((x0 / BLOCK_SIZE) * d));
  const ty0 = Math.max(0, Math.floor((y0 / BLOCK_SIZE) * d));
  const tx1 = Math.min(d - 1, Math.floor((x1 / BLOCK_SIZE) * d));
  const ty1 = Math.min(d - 1, Math.floor((y1 / BLOCK_SIZE) * d));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      yield {
        id: `${d}_${blockId}_${ty}_${tx}`,
        x: bx * BLOCK_SIZE + (tx * BLOCK_SIZE) / d,
        y: by * BLOCK_SIZE + (ty * BLOCK_SIZE) / d,
      };
    }
  }
}

function setup() {
  const container = document.getElementById("container");
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("canvas");

  const resize = () => {
    const state = viewport.state;
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
    canvas.width = Math.floor(state.width * state.pixelRatio);
    canvas.height = Math.floor(state.height * state.pixelRatio);
  };

  const viewport = new ViewportController(container, {
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    onChange: (state) => {
      if (
        state.width !== store.viewport.width ||
        state.height !== store.viewport.height ||
        state.pixelRatio !== store.viewport.pixelRatio
      ) {
        resize();
      }

      store.viewport = state;
    },
    onClick: (screenX, screenY) => {
      store.clickedLocation = { screenX, screenY };
    },
  });

  resize();

  const layersData = document.getElementById("layers-ui")._x_dataStack[0];
  layersData.$watch("layers", (layers) => {
    store.layers = layers;
  });

  const subscriptions = [];
  const store = new Proxy(
    {
      /** @type {{screenX: number, screenY: number} | null} */
      clickedLocation: null,
      viewport: viewport.state,
      // dimensions: viewportResizeObserver.state,
      /** @type {Layer[]} */
      layers: layersData.layers,

      /** @param {(s: typeof store) => void} callback */
      subscribe(callback) {
        subscriptions.push(callback);

        return () => {
          subscriptions.splice(subscriptions.indexOf(callback), 1);
        };
      },
    },
    {
      set(target, prop, newValue) {
        target[prop] = newValue;

        for (const subscription of subscriptions) {
          subscription(store);
        }

        return true;
      },
    }
  );

  const initialScale =
    0.8 *
    Math.min(
      viewport.state.width / CONTENT_WIDTH,
      viewport.state.height / CONTENT_HEIGHT
    );
  viewport.setTransform({
    scale: initialScale,
    x: (-CONTENT_WIDTH / 2) * initialScale,
    y: (-CONTENT_HEIGHT / 2) * initialScale,
  });

  const manifestPromise = fetch("data/manifest.json")
    .then((res) => res.json())
    .catch((err) => {
      console.error(err);
      alert("Failed to load manifest.json");
    })
    .then((manifest) => {
      /** @type {string[]} */
      const datasets = [...manifest.tile_props, ...manifest.tile_sets]
        .filter((d) => !d.endsWith("out"))
        .map((d) => d.replace(/_in$/, ""));

      layersData.datasets = [...new Set([...layersData.datasets, ...datasets])];

      const [allocationPlots, publisherPlots] = [
        "allocation_plots",
        "publisher_plots",
      ].map((d) => {
        /** @type {string[]} */
        const plots = manifest[d];
        return plots.map((filename) => ({
          // group number should be implicit based on list index
          // group: parseInt(filename.replace(/r$/, "")),
          url: `data/${d}/${filename}.png`,
          rotated: filename.endsWith("r"),
        }));
      });

      // TODO: manifest.isbn_publishers
      return {
        allocationPlots,
        publisherPlots,
      };
    });

  return { store, manifestPromise };
}

function main() {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("canvas");

  const { store, manifestPromise } = setup();

  store.subscribe(() => {
    draw();
  });

  //#region RANGE PLOTS

  // fetch agency plot then draw onto canvas
  const agencyPlotUrl = "data/agency_plot.png";
  const agencyPlotCanvas = document.createElement("canvas");

  const agencyPlot = new ImageFetcher(agencyPlotUrl, () => {
    const ctx = agencyPlotCanvas.getContext("2d", { alpha: false });
    agencyPlotCanvas.width = agencyPlot.image.width;
    agencyPlotCanvas.height = agencyPlot.image.height;
    ctx.fillStyle = COLOR_RANGE_AGENCY;
    ctx.fillRect(0, 0, agencyPlotCanvas.width, agencyPlotCanvas.height);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(agencyPlot.image, 0, 0);
    draw();
  });

  const plotSets = ["allocationPlots", "publisherPlots"];
  const plotCanvasSections = plotSets.map((_) =>
    // index 10 is temp canvas
    Array.from({ length: 11 }, (_) => {
      const canvas = document.createElement("canvas");
      canvas.width = PLOT_WIDTH;
      canvas.height = PLOT_HEIGHT / 10;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, PLOT_WIDTH, PLOT_HEIGHT / 10);
      return canvas;
    })
  );

  //#endregion

  //#region TILES
  const tilesCanvas1 = document.createElement("canvas");
  const tilesCanvas2 = document.createElement("canvas");
  const tilesCanvas3 = document.createElement("canvas");

  /** @type {Map<string, ImageFetcher>} */
  const tile_fetcher_map = new Map();

  //#endregion

  manifestPromise.then((manifest) => {
    // return;
    plotSets.forEach((plotSet, plotSetIndex) => {
      manifest[plotSet].forEach((plot) => {
        new ImageFetcher(plot.url, (fetcher) => {
          for (let i = 0; i < 10; i++) {
            {
              const ctx = plotCanvasSections[plotSetIndex][10].getContext("2d");

              ctx.globalCompositeOperation = "source-over";
              ctx.fillStyle = [COLOR_RANGE_ALLOCATION, COLOR_RANGE_PUBLISHER][
                plotSetIndex
              ];
              ctx.fillRect(0, 0, PLOT_WIDTH, PLOT_HEIGHT / 10);

              ctx.globalCompositeOperation = "multiply";

              ctx.drawImage(
                fetcher.image,
                0,
                i * (fetcher.image.height / 10),
                fetcher.image.width,
                fetcher.image.height / 10,
                0,
                0,
                PLOT_WIDTH,
                PLOT_HEIGHT / 10
              );
            }
            const ctx = plotCanvasSections[plotSetIndex][i].getContext("2d");

            ctx.globalCompositeOperation = "lighten"; // max
            ctx.drawImage(plotCanvasSections[plotSetIndex][10], 0, 0);
          }
          draw();
        });
      });
    });
  });

  let raf;
  const scheduleDraw = () => {
    // console.log("scheduleDraw");
    if (!raf) {
      // console.log("DRAW scheuculed");

      raf = setTimeout(() => {
        draw();
        raf = null;
      }, 0);
    }
  };

  const setupViewport = (ctx) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(store.viewport.pixelRatio, store.viewport.pixelRatio);
    ctx.translate(
      store.viewport.x + store.viewport.width / 2,
      store.viewport.y + store.viewport.height / 2
    );
    ctx.scale(store.viewport.scale, store.viewport.scale);
  };
  const draw = () => {
    // console.log("DRAW");
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.save();
    /* viewport transforms */
    setupViewport(ctx);

    /* ranges */
    {
      ctx.save();
      ctx.imageSmoothingEnabled = false;

      ctx.globalCompositeOperation = "lighten"; // max

      ctx.save();
      ctx.drawImage(agencyPlotCanvas, 0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);
      ctx.restore();

      for (let plotSetIndex = 0; plotSetIndex < 2; plotSetIndex++) {
        for (let i = 0; i < 10; i++) {
          const section = plotCanvasSections[plotSetIndex][i];
          ctx.drawImage(
            section,
            0,
            i * (CONTENT_HEIGHT / 10),
            CONTENT_WIDTH,
            CONTENT_HEIGHT / 10
          );
        }
      }

      ctx.restore();
    }
    ctx.restore();

    /* tiles */
    {
      ctx.save();
      // ctx.imageSmoothingEnabled = store.viewport.scale < 1;

      const [x0, y0] = screenToContent([0, 0], store.viewport);
      const [x1, y1] = screenToContent(
        [store.viewport.width, store.viewport.height],
        store.viewport
      );

      tilesCanvas1.width = canvas.width;
      tilesCanvas1.height = canvas.height;
      tilesCanvas2.width = canvas.width;
      tilesCanvas2.height = canvas.height;
      tilesCanvas3.width = canvas.width;
      tilesCanvas3.height = canvas.height;

      const t2Ctx = tilesCanvas2.getContext("2d", { alpha: false });
      const t1Ctx = tilesCanvas1.getContext("2d", { alpha: false });
      const t3Ctx = tilesCanvas3.getContext("2d", { alpha: false });

      t3Ctx.globalCompositeOperation = "source-over";
      t3Ctx.fillStyle = "black";
      t3Ctx.fillRect(0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);

      for (const layer of store.layers) {
        if (!layer.visible) continue;
        const isTileProps = ["years", "holdings"].includes(layer.dataset);
        const scales = isTileProps ? PROPS_SCALES : DATASET_SCALES;

        t1Ctx.save();

        setupViewport(t1Ctx);

        t1Ctx.imageSmoothingEnabled = !isTileProps && store.viewport.scale < 1;

        const closest_scale = getClosestScale(
          store.viewport.scale,
          DATASET_SCALES
        );

        t2Ctx.globalCompositeOperation = "source-over";
        t2Ctx.fillStyle = "black";
        t2Ctx.fillRect(0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);

        let subsets = [];
        if (layer.dataset === "md5") {
          subsets = [layer.dataset];
        } else if (layer.mode === "all") {
          subsets = [layer.dataset + "_in", layer.dataset + "_out"];
        } else {
          subsets = [layer.dataset + "_" + layer.mode];
        }

        for (const subset of subsets) {
          t1Ctx.globalCompositeOperation = "source-over";
          t1Ctx.fillStyle = "black";
          t1Ctx.fillRect(0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);

          for (const scale of scales) {
            const should_break = scale.d === closest_scale.d;
            for (const blockCoords of rangeBlockCoords(x0, y0, x1, y1)) {
              for (const tile of rangeTiles(blockCoords, scale)) {
                const tile_url = `data/${
                  isTileProps ? "tile_props" : "tile_sets"
                }/${subset}/${tile.id}.png`;
                let tileFetcher = tile_fetcher_map.get(tile_url);
                if (!tileFetcher) {
                  tileFetcher = new ImageFetcher(tile_url, (fetcher) => {
                    scheduleDraw();
                  });
                  tile_fetcher_map.set(tile_url, tileFetcher);
                }

                if (tileFetcher.loaded) {
                  t1Ctx.drawImage(
                    tileFetcher.image,
                    tile.x,
                    tile.y,
                    BLOCK_SIZE / scale.d,
                    BLOCK_SIZE / scale.d
                  );
                } else if (tileFetcher.notFound) {
                  t1Ctx.fillRect(
                    tile.x,
                    tile.y,
                    BLOCK_SIZE / scale.d,
                    BLOCK_SIZE / scale.d
                  );
                }
              }
            }
            if (should_break) {
              break;
            }
          }

          // accumulate layer subset

          t2Ctx.globalCompositeOperation = isTileProps ? "lighten" : "lighter"; // MAX / ADD

          t2Ctx.drawImage(tilesCanvas1, 0, 0);
        }
        t1Ctx.restore();

        // do cutoffs if needed
        let propsFloor = PROPS_BRIGHTNESS_FLOOR;
        if (isTileProps) {
          t2Ctx.globalCompositeOperation = "multiply";

          if (layer.cutoff < 255) {
            // t2Ctx.globalCompositeOperation = "source-over";
            t2Ctx.filter = filterThreshold(255 - layer.cutoff);
            t2Ctx.drawImage(tilesCanvas2, 0, 0);
          }

          if (layer.dataset === "years" && layer.lowerCutoff > 1) {
            t2Ctx.filter = `${filterThreshold(
              256 - layer.lowerCutoff
            )} invert(1)`;
            t2Ctx.drawImage(tilesCanvas2, 0, 0);

            propsFloor +=
              ((1 - DATASET_BRIGHTNESS_FLOOR) * (layer.lowerCutoff - 1)) / 255;
          }

          // raise brightness floor for props
          {
            t1Ctx.save();
            t1Ctx.globalCompositeOperation = "source-over";
            t1Ctx.clearRect(0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);

            t1Ctx.filter = `${filterThreshold()} brightness(${propsFloor})`;
            t1Ctx.drawImage(tilesCanvas2, 0, 0);
            t1Ctx.restore();
          }

          t2Ctx.globalCompositeOperation = "source-over";
          t2Ctx.filter = `brightness(${1 - propsFloor})`;
          t2Ctx.drawImage(tilesCanvas2, 0, 0);

          t2Ctx.globalCompositeOperation = "lighter"; // ADD
          t2Ctx.filter = "none";
          t2Ctx.drawImage(tilesCanvas1, 0, 0);
        }

        // add color
        t2Ctx.globalCompositeOperation = "multiply";
        t2Ctx.fillStyle = layer.color;
        t2Ctx.fillRect(0, 0, CONTENT_WIDTH, CONTENT_HEIGHT);

        // accumulate layer
        t3Ctx.globalCompositeOperation = "lighter"; // ADD
        t3Ctx.drawImage(tilesCanvas2, 0, 0);
      }

      // add accumulated layers to main canvas
      ctx.globalCompositeOperation = "lighter"; // ADD
      // ctx.globalCompositeOperation = "lighten"; // MAX

      ctx.filter = `${filterThreshold()} brightness(${DATASET_BRIGHTNESS_FLOOR})`;
      ctx.drawImage(tilesCanvas3, 0, 0);

      ctx.filter = `brightness(${1 - DATASET_BRIGHTNESS_FLOOR})`;
      ctx.drawImage(tilesCanvas3, 0, 0);

      ctx.restore();
    }
  };
}

class ImageFetcher {
  /**
   * @param {string} url
   * @param {(image: ImageFetcher) => void} onFetch
   */
  constructor(url, onFetch) {
    this.loaded = false;
    this.notFound = false;
    this.url = url;

    this.image = new Image();
    this.image.onload = () => {
      this.loaded = true;
      onFetch(this);
    };
    this.image.onerror = (e) => {
      this.notFound = true;
      onFetch(this);
    };

    this.image.src = url;
  }
}

main();
