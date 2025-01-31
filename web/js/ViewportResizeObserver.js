export default class ViewportResizeObserver {
  /** @param {HTMLElement} container
   * @param {(dimensions: { width: number, height: number, pixelRatio: number }) => void} onResize */
  constructor(container, onResize) {
    this._container = container;
    this._onResize = onResize;
    this._resizeObserver = new ResizeObserver(this._handleResize);
    this._resizeObserver.observe(this._container);

    this.state = {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio
    };
  }

  /** @type {ResizeObserverCallback} */
  _handleResize = (entries) => {
    for (const entry of entries) {
      if (entry.target === this._container) {
        this.width = entry.contentRect.width;
        this.height = entry.contentRect.height;
      }
    }
    this.state = {
      width: this.width,
      height: this.height,
      pixelRatio: window.devicePixelRatio
    };

    this._onResize(this.state);
  };
}
