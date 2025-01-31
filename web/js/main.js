import ViewportController from "./ViewportController.js";

import { screenToContent, contentToScreen } from "./Transform.js";

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
const COLOR_RANGE_PUBLISHER = "rgb(10, 20, 25)";

const COLOR_GRID_MAIN = "rgb(34, 34, 34)";
const COLOR_GRID_MAIN_H = "rgb(173, 173, 173)";
const COLOR_GRID_AGENCY = "rgb(168, 0, 160)";
const COLOR_GRID_AGENCY_H = "rgb(255, 37, 244)";
const COLOR_GRID_PUBLISHER = "rgb(20, 0, 168)";
const COLOR_GRID_PUBLISHER_H = "rgb(66, 37, 255)";

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

const lerp = (k, a, b) => a - k * (a - b);
const ilerp = (x, a, b) => (x - a) / (b - a);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (t) => t * (2 - t);

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

// function* genPrefixes(gx, gy) {
//   const [p0, p1] = toBlockId({
//     bx: Math.max(0, Math.min(4, Math.floor(gx / BLOCK_SIZE))),
//     by: Math.max(0, Math.min(3, Math.floor(gy / BLOCK_SIZE))),
//   });

//   let prefix = `${p0}${p1}`;
//   for (let i = 0; i < 8; i++) {
//     const j = (i / 2) | 0;
//     const n = i % 2 === 0 ? gy : gx;

//     const digit = ((n / 10 ** (3 - j)) | 0) % 10;
//     prefix = prefix + digit;
//   }

//   while (prefix.endsWith("0") && prefix.length > 2) {
//     yield prefix;
//     prefix = prefix.slice(0, -1);
//   }
//   yield prefix;
// }
// for (const prefix of genPrefixes(0, 0)) {
//   console.log(prefix);
// }
// for (const prefix of genPrefixes(12345, 0)) {
//   console.log(prefix);
// }
// for (const prefix of genPrefixes(12345, 12345)) {
//   console.log(prefix);
// }
// for (const prefix of genPrefixes(12340, 12300)) {
//   console.log(prefix);
// }
function getISBNFromPos(gx, gy, length) {
  const bx = Math.max(0, Math.min(4, Math.floor(gx / BLOCK_SIZE)));
  const by = Math.max(0, Math.min(3, Math.floor(gy / BLOCK_SIZE)));
  const p0 = Math.floor(by / 2);
  const p1 = bx + (by % 2) * 5;

  let prefix = `${p0}${p1}`;
  for (let i = 0; i < length - 2; i++) {
    const j = (i / 2) | 0;
    const n = i % 2 === 0 ? gy : gx;

    const digit = ((n / 10 ** (3 - j)) | 0) % 10;
    prefix = prefix + digit;
  }
  return prefix;
}

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
  layersData.$watch("params", (params) => {
    store.params = params;
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
      params: layersData.params,

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

      return {
        allocationPlots,
        publisherPlots,
        publisherFiles: manifest.isbn_publishers,
      };
    });

  const agenciesPromise = fetch("data/isbn_agencies.json")
    .then((res) => res.json())
    .catch((err) => {
      console.error(err);
      alert("Failed to load isbn_agencies.json");
    });

  return { store, manifestPromise, agenciesPromise };
}

function main() {
  /** @type {HTMLCanvasElement} */
  const mainCanvas = document.getElementById("canvas");

  const { store, manifestPromise, agenciesPromise } = setup();

  store.subscribe(() => {
    draw();
  });

  // primary working canvas
  const canvas = document.createElement("canvas");

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
  const publisherPlotImages = [];
  const publisherPlotQueryCanvas = document.createElement("canvas");
  function queryPublisherPlots(
    group,
    gx,
    gy,
    gw,
    gh,
    image = group < 5 ? publisherPlotImages[group] : -1,
    offsetY = 0
  ) {
    const hasPublisher = new Set();
    if (group < 5 && !image) {
      return hasPublisher;
    }
    if (group === 5 && image === -1) {
      for (let i = 0; i < 10; i++) {
        const gy0 = gy - i * 4000;
        if (gy0 > 4000 || gy0 + gh < 0) continue;

        const image = plotCanvasSections[1][i];

        const results = queryPublisherPlots(
          group,
          gx,
          gy0,
          gw,
          Math.min(4000, gy0 + gh) - gy0,
          image,
          i * 4000
        );
        for (const isbn of results) {
          hasPublisher.add(isbn);
        }
      }
      return hasPublisher;
    }

    const [pw, ph] = [
      [1000, 1000],
      [1000, 100],
      [100, 100],
      [100, 10],
      [10, 10],
      [10, 1],
    ][group];

    const x = Math.floor(gx / pw);
    const y = Math.floor(gy / ph);
    const w = Math.ceil(gw / pw) + 1;
    const h = Math.ceil(gh / ph) + 1;

    const ctx = publisherPlotQueryCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    if (publisherPlotQueryCanvas.width < w) {
      publisherPlotQueryCanvas.width = w;
    }
    if (publisherPlotQueryCanvas.height < h) {
      publisherPlotQueryCanvas.height = h;
    }
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const offset = (i * w + j) * 4;
        const value = data[offset];
        if (value === 0) continue;
        const isbn = getISBNFromPos(
          gx + j * pw,
          gy + i * ph + offsetY,
          group + 4
        );
        hasPublisher.add(isbn);
      }
    }

    return hasPublisher;
  }

  //#endregion

  //#region TILES
  const tilesCanvas1 = document.createElement("canvas");
  const tilesCanvas2 = document.createElement("canvas");
  const tilesCanvas3 = document.createElement("canvas");

  /** @type {Map<string, ImageFetcher>} */
  const tile_fetcher_map = new Map();

  //#endregion

  const publisherInfoMap = new Map();
  const publisherDataFetcherMap = new Map();
  function getDeferredPublisherInfo(isbn) {
    if (publisherInfoMap.has(isbn)) {
      return publisherInfoMap.get(isbn);
    }
    manifestPromise.then(({ publisherFiles }) => {
      let index = publisherFiles.findIndex((s) => s > isbn) - 1;
      if (index < 0) {
        index = publisherFiles.length - 1;
      }

      const publisherDataKey = publisherFiles[index];
      if (!publisherDataFetcherMap.has(publisherDataKey)) {
        publisherDataFetcherMap.set(publisherDataKey, false);
        fetch(`data/isbn_publishers/${publisherDataKey}.json`)
          .then((res) => res.json())
          .catch((err) => {
            console.error(err);
            alert(`Failed to load ${publisherDataKey}.json`);
          })
          .then((data) => {
            publisherDataFetcherMap.set(publisherDataKey, true);
            for (const key in data) {
              publisherInfoMap.set(key, data[key]);
            }
            scheduleDraw();
          });
      }
    });
  }

  manifestPromise.then((manifest) => {
    plotSets.forEach((plotSet, plotSetIndex) => {
      manifest[plotSet].forEach((plot, i) => {
        new ImageFetcher(plot.url, (fetcher) => {
          if (plotSet === "publisherPlots" && i < 5) {
            publisherPlotImages[i] = fetcher.image;
          }
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

  let agencies = {};
  agenciesPromise.then((data) => {
    agencies = data;
    draw();
  });

  let raf;
  const scheduleDraw = () => {
    if (!raf) {
      raf = setTimeout(() => {
        draw();
        raf = null;
      }, 0);
    }
  };

  const setupViewport = (ctx) => {
    ctx.scale(store.viewport.pixelRatio, store.viewport.pixelRatio);
    ctx.translate(
      store.viewport.x + store.viewport.width / 2,
      store.viewport.y + store.viewport.height / 2
    );
    ctx.scale(store.viewport.scale, store.viewport.scale);
  };
  const draw = () => {
    let [vx0, vy0] = screenToContent([0, 0], store.viewport);
    let [vx1, vy1] = screenToContent(
      [store.viewport.width, store.viewport.height],
      store.viewport
    );
    vx0 = Math.max(vx0, 0);
    vy0 = Math.max(vy0, 0);
    vx1 = Math.min(vx1, CONTENT_WIDTH);
    vy1 = Math.min(vy1, CONTENT_HEIGHT);
    // TODO: get the content coords from recursive grid

    canvas.width = mainCanvas.width;
    canvas.height = mainCanvas.height;
    // console.log("DRAW");
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.save();
    /* viewport transforms */
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

        const closest_scale = getClosestScale(store.viewport.scale, scales);

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
            for (const blockCoords of rangeBlockCoords(vx0, vy0, vx1, vy1)) {
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
              ((1 - PROPS_BRIGHTNESS_FLOOR) * (layer.lowerCutoff - 1)) / 255;
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

    const mCtx = mainCanvas.getContext("2d", { alpha: false });
    ctx.font = `8px Courier New`;
    mCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    // mCtx.drawImage(canvas, 0, 0);

    let currAgency;
    let currAgencyPrefix;
    let currPublisherPrefix;
    let currIsbn;

    /* grid */
    {
      mCtx.save();
      setupViewport(mCtx);

      mCtx.lineWidth = 1 / store.viewport.scale;
      // mCtx.strokeStyle = COLOR_GRID_MAIN;

      const publisherPlotSets = [];

      function recurseGrid(
        pass,
        x0,
        y0,
        s0,
        m0,
        scale = store.viewport.scale,
        // grid space: coords/size
        gx = x0,
        gy = y0,
        gs = s0
      ) {
        const group = 10 - Math.log10(gs) * 2;

        const x1 = x0 + m0;
        const y1 = y0 + m0;
        const s1 = s0 - m0 * 2;

        const [cx, cy] = screenToContent(
          [store.viewport.cursorX, store.viewport.cursorY],
          store.viewport
        );

        const df = store.params.divisionFactor ** 2;
        const k0 = ilerp((s1 / 10) * scale * df, 50, 100);
        let k = k0;
        if (gs === BLOCK_SIZE) {
          k = Math.max(k, lerp(k, 0.5, 1));
        }
        k = ease(clamp(k));

        if (group >= 4 && group < 9) {
          if (!publisherPlotSets[group - 4]) {
            publisherPlotSets[group - 4] = queryPublisherPlots(
              group - 4,
              vx0,
              vy0,
              vx1 - vx0,
              vy1 - vy0
            );

            // console.log(publisherPlotSets.map((s) => s.size).join());
          }
          if (k0 > -0.5 && !publisherPlotSets[group - 3]) {
            let publisherSet = queryPublisherPlots(
              group - 3,
              vx0,
              vy0,
              vx1 - vx0,
              vy1 - vy0
            );
            if (group === 8) {
              for (let isbn of publisherSet) {
                for (let i = 0; i < 5; i++) {
                  if (publisherPlotSets[i].has(isbn.slice(0, 4 + i))) {
                    publisherSet.delete(isbn);
                  }
                }
              }
            }

            publisherPlotSets[group - 3] = publisherSet;

            // console.log(group, publisherPlotSets.map((s) => s.size).join());
          }
        }

        let m1 = m0 * k;

        const x2 = x1 + m1 * 0.5;
        const y2 = y1 + m1 * 0.5;
        const s2 = s1 - m1;
        const s20 = s2 / 10 - m1;

        const k2 = clamp(ilerp(k, 0.3, 0));
        if (k2 > 0 && pass === 1) {
          mCtx.save();

          mCtx.globalAlpha = k2;

          let [x, y] = contentToScreen([gx, gy], store.viewport);
          x *= store.viewport.pixelRatio;
          y *= store.viewport.pixelRatio;
          const s = gs * scale * store.viewport.pixelRatio;
          mCtx.drawImage(canvas, x, y, s, s, x1, y1, s1, s1);

          mCtx.restore();
        }

        const drawText = (x, y, w, h, text) => {
          const fontSize = 12;
          const maxLength = (((w * scale) / fontSize) * 1.5) | 0;
          if (text.length > maxLength) {
            text = text.slice(0, maxLength) + "…";
          }
          mCtx.save();
          mCtx.globalCompositeOperation = "difference";
          const size = fontSize / scale;
          mCtx.font = `${size}px Courier New`;
          mCtx.textBaseline = "top";
          mCtx.fillStyle = "white";

          const x0 = x + m0 + 1 / scale;
          const y0 = y + m0 + 1 / scale;
          const x1 = x + w - (m0 + 1 / scale);
          const y1 = y + h - (m0 + 1 / size);
          mCtx.fillText(text, x0, y0);
          mCtx.restore();
        };

        const inside = cx > x1 && cx < x1 + s1 && cy > y1 && cy < y1 + s1;

        const prefix = getISBNFromPos(gx, gy, group);
        const agency = agencies[prefix];
        const hasPublisher = publisherPlotSets[group - 4]?.has(prefix);
        const hasHighlight = agency || hasPublisher;

        if (inside) {
          currIsbn = prefix;
          if (agency) {
            currAgency = agency;
            currAgencyPrefix = prefix;
          }
          if (hasPublisher) {
            currPublisherPrefix = prefix;
          }
        }
        if (
          (pass === 0 && store.params.overlay && !hasHighlight) ||
          (pass === 2 && store.params.overlay && hasHighlight) ||
          (pass === 3 && inside)
        ) {
          mCtx.strokeStyle = [
            COLOR_GRID_MAIN,
            ,
            hasPublisher ? COLOR_GRID_PUBLISHER : COLOR_GRID_AGENCY,
            hasPublisher
              ? COLOR_GRID_PUBLISHER_H
              : agency
              ? COLOR_GRID_AGENCY_H
              : COLOR_GRID_MAIN_H,
          ][pass];
          mCtx.lineWidth = (pass === 3 ? 2 : 1) / store.viewport.scale;
          mCtx.strokeRect(x1, y1, s1, s1);
        }
        if (
          pass === 3 &&
          agency &&
          s0 * scale > 100 &&
          (store.params.overlay || inside)
        ) {
          drawText(x1, y1, s1, s1, agency);
        }

        mCtx.save();

        for (let i = 0; i < 10; i++) {
          let y = y2 + (s2 / 10) * i + m1 * 0.5;
          if (y + s20 < vy0 || y > vy1) continue;

          // the row

          const prefix = getISBNFromPos(gx, gy + (i * gs) / 10, group + 1);
          const agency = agencies[prefix];
          const hasPublisher = publisherPlotSets[group - 3]?.has(prefix);
          const hasHighlight = agency || hasPublisher;

          const x = x2 + m1 * 0.5;
          const inside =
            (k > 0 || k0 > -0.5) &&
            cx > x &&
            cx < x + s2 - m1 &&
            cy > y &&
            cy < y + s20;

          if (inside) {
            currIsbn = prefix;
            if (agency) {
              currAgency = agency;
              currAgencyPrefix = prefix;
            }
            if (hasPublisher) {
              currPublisherPrefix = prefix;
            }
          }

          if (
            (pass === 0 && store.params.overlay && !hasHighlight) ||
            (pass === 2 &&
              store.params.overlay &&
              hasHighlight &&
              (k > 0 || k0 > -0.5)) ||
            (pass === 3 && inside)
          ) {
            mCtx.strokeStyle = [
              COLOR_GRID_MAIN,
              ,
              hasPublisher ? COLOR_GRID_PUBLISHER : COLOR_GRID_AGENCY,
              hasPublisher
                ? COLOR_GRID_PUBLISHER_H
                : agency
                ? COLOR_GRID_AGENCY_H
                : COLOR_GRID_MAIN_H,
            ][pass];

            mCtx.lineWidth = (pass === 3 ? 2 : 1) / store.viewport.scale;
            mCtx.strokeRect(x, y, s2 - m1, s20);
          }
          if (
            pass === 3 &&
            agency &&
            s0 * scale > 200 &&
            (store.params.overlay || inside)
          ) {
            drawText(x, y, s1, s1 / 10, agency);
          }

          for (let j = 0; j < 10; j++) {
            if (k > 0 || (pass === 3 && k0 > -0.5)) {
              let x = x2 + (s2 / 10) * j + m1 * 0.5;
              if (x + s20 < vx0 || x > vx1) continue;

              recurseGrid(
                pass,
                x,
                y,
                s20,
                m0 * k,
                scale,
                gx + (j * gs) / 10,
                gy + (i * gs) / 10,
                gs / 10
              );
            }
          }
        }

        mCtx.restore();
      }

      const m0 =
        (store.params.margin * 0.5 * store.viewport.pixelRatio) /
        store.viewport.scale;
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 5; j++) {
            recurseGrid(pass, j * BLOCK_SIZE, i * BLOCK_SIZE, BLOCK_SIZE, m0);
          }
        }
      }

      mCtx.restore();
    }

    const statusUi = document.getElementById("status-ui")._x_dataStack[0];

    statusUi.agency = currAgency || "";
    if (currIsbn) {
      let isbn = currIsbn;
      let remainingLength = 10 - isbn.length;
      if (currAgencyPrefix) {
        if (currPublisherPrefix) {
          let rest = isbn.slice(currPublisherPrefix.length);
          isbn = currPublisherPrefix;
          isbn += "-" + rest;
        }
        let rest = isbn.slice(currAgencyPrefix.length);
        isbn = currAgencyPrefix;
        isbn += "-" + rest;
      }
      if (remainingLength > 0) {
        isbn += "·".repeat(remainingLength);
      }
      if (isbn.startsWith("0")) {
        isbn = "978-" + isbn.slice(1);
      } else if (isbn.startsWith("1")) {
        isbn = "979-" + isbn.slice(1);
      }
      statusUi.isbn = isbn;
    } else {
      statusUi.isbn = "";
    }
    if (currPublisherPrefix) {
      const info = getDeferredPublisherInfo(currPublisherPrefix);
      if (info) {
        statusUi.publisher = info.join(", ");
      }
    } else {
      statusUi.publisher = "";
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
