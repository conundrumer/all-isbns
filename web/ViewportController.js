import PointerInputHandler from './PointerInputHandler.js';
import { singleAnchorTransform, doubleAnchorTransform, screenToContent, contentToScreen } from './Transform.js';

class ViewportController {
  /** @type {HTMLElement} */
  _container;

  /** @type {import('./PointerInputHandler.js').default} */
  _pointerHandler;

  /** @type {{ x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }} */
  _state = { x: 0, y: 0, scale: 1, cursorX: null, cursorY: null };

  /** @type {{
    onChange?: (state: { x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }) => void,
    onClick?: (x: number, y: number) => void,
    minScale?: number,
    maxScale?: number,
    wheelZoomSpeed?: number
  }} */
  _options;

  /** @type {Array<{
    id: number,
    screenPoint: [number, number],
    contentPoint: [number, number]
  }>} */
  _activePointers = [];

  /** @type {boolean} */
  _pointerMoved = false;

  /**
   * Create viewport controller
   * @param {HTMLElement} container - Container element for viewport
   * @param {{
   *   onChange?: (state: { x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }) => void,
   *   onClick?: (x: number, y: number) => void,
   *   minScale?: number,
   *   maxScale?: number,
   *   wheelZoomSpeed?: number
   * }} [options={}] - Configuration options
   */
  constructor(container, options = {}) {
    this._container = container;
    this._options = {
      minScale: 1e-2,
      maxScale: 1e2,
      wheelZoomSpeed: 0.01,
      onChange: () => {},
      onClick: () => {},
      ...options
    };

    this._pointerHandler = new PointerInputHandler(container, {
      onPointerDown: this._handlePointerDown,
      onPointerUp: this._handlePointerUp,
      onPointerDrag: this._handlePointerMove,
      onPointerHover: this._handlePointerHover,
      onWheel: this._handleWheel
    });
  }

  /**
   * @param {Partial<{ x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }>} newState
   * @private
   */
  _setState(newState) {
    const scale = newState.scale !== undefined ?
      Math.min(Math.max(newState.scale, this._options.minScale), this._options.maxScale) :
      this._state.scale;

    this._state = {
      ...this._state,
      ...newState,
      scale
    };

    this._options.onChange(this._state);
  }

  /**
   * Handle pointer hover events
   * @param {{ x: number, y: number }} data - Pointer event data
   * @private
   */
  _handlePointerHover = (data) => {
    const [contentX, contentY] = screenToContent([data.x, data.y], this._state);
    this._setState({
      cursorX: contentX,
      cursorY: contentY
    });
  }

  /**
   * Handle pointer down events
   * @param {{
   *   pointerType: string,
   *   pointerId: number,
   *   x: number,
   *   y: number
   * }} data - Pointer event data
   * @private
   */
  _handlePointerDown = (data) => {
    const screenPoint = [data.x, data.y];
    const contentPoint = screenToContent(screenPoint, this._state);

    if (this._activePointers.length === 0) {
      this._pointerMoved = false
    }

    // Add new pointer
    this._activePointers.push({
      id: data.pointerId,
      screenPoint,
      contentPoint
    });

    // If we now have exactly 2 pointers, reset both pointers' reference points
    // to their current positions to avoid sudden jumps
    if (this._activePointers.length === 2) {
      const p = this._activePointers[0];
      const q = this._activePointers[1];

      p.screenPoint = [p.id === data.pointerId ? data.x : p.screenPoint[0],
                      p.id === data.pointerId ? data.y : p.screenPoint[1]];
      p.contentPoint = screenToContent(p.screenPoint, this._state);

      q.screenPoint = [q.id === data.pointerId ? data.x : q.screenPoint[0],
                      q.id === data.pointerId ? data.y : q.screenPoint[1]];
      q.contentPoint = screenToContent(q.screenPoint, this._state);
    }
  }

  /**
   * Handle pointer up events
   * @param {{ pointerId: number }} data - Pointer event data
   * @private
   */
  _handlePointerUp = (data) => {
    // If we're going from 2 pointers to 1, reset the remaining pointer's
    // reference points to avoid sudden jumps
    if (this._activePointers.length === 2) {
      const remainingPointer = this._activePointers.find(p => p.id !== data.pointerId);
      if (remainingPointer) {
        remainingPointer.contentPoint = screenToContent(remainingPointer.screenPoint, this._state);
      }
    }

    // Remove the pointer
    this._activePointers = this._activePointers.filter(p => p.id !== data.pointerId);

    if (this._activePointers.length === 0 && !this._pointerMoved) {
      this._options.onClick(data.x, data.y)
    }
  }

  /**
   * Handle pointer move events
   * @param {{ pointerId: number, x: number, y: number }} data - Pointer event data
   * @private
   */
  _handlePointerMove = (data) => {
    const pointerIndex = this._activePointers.findIndex(p => p.id === data.pointerId);
    if (pointerIndex === -1) return;

    this._pointerMoved = true

    const currentPointer = this._activePointers[pointerIndex];
    const newScreenPoint = [data.x, data.y];
    // Only update cursor position for mouse input during drag
    if (data.pointerType === 'mouse') {
      const [contentX, contentY] = screenToContent(newScreenPoint, this._state);
      this._setState({
        cursorX: contentX,
        cursorY: contentY
      });
    }

    if (this._activePointers.length === 1) {
      // Single pointer pan
      const { dx, dy } = singleAnchorTransform(
        currentPointer.screenPoint,
        newScreenPoint
      );

      this._setState({
        x: this._state.x + dx,
        y: this._state.y + dy
      });
    }
    else if (this._activePointers.length === 2) {
      // Dual pointer pan + zoom
      const otherPointer = this._activePointers[1 - pointerIndex];

      const newTransform = doubleAnchorTransform(
        currentPointer.contentPoint,
        otherPointer.contentPoint,
        newScreenPoint,
        otherPointer.screenPoint,
        this._options.minScale,
        this._options.maxScale
      );

      this._setState(newTransform);
    }

    // Update stored screen point
    currentPointer.screenPoint = newScreenPoint;
  }

  /**
   * Handle wheel events for zoom
   * @param {{
   *   x: number,
   *   y: number,
   *   deltaX: number,
   *   deltaY: number,
   *   trackpad: boolean,
   *   pinch: boolean
   * }} data - Wheel event data
   * @private
   */
  _handleWheel = (data) => {
    if (data.trackpad && !data.pinch) {
      // Pan for trackpad scroll
      const nextState = {
        x: this._state.x - data.deltaX,
        y: this._state.y - data.deltaY
      }
      const [contentX, contentY] = screenToContent([data.x, data.y], {...this._state, ...nextState});
      this._setState({
        ...nextState,
        cursorX: contentX,
        cursorY: contentY
      });
    } else {
      // Zoom for mouse wheel or trackpad pinch
      const contentPoint = screenToContent([data.x, data.y], this._state);
      const scaleFactor = Math.exp(-data.deltaY * this._options.wheelZoomSpeed);
      const newScale = Math.min(Math.max(
        this._state.scale * scaleFactor,
        this._options.minScale
      ), this._options.maxScale);

      // Only adjust position if scale actually changed
      if (newScale !== this._state.scale) {
        // Calculate new position to zoom around cursor point
        const newScreenPoint = contentToScreen(contentPoint, {
          ...this._state,
          scale: newScale
        });

        this._setState({
          scale: newScale,
          x: this._state.x + (data.x - newScreenPoint[0]),
          y: this._state.y + (data.y - newScreenPoint[1])
        });
      }
    }
  }

  /**
   * Get current viewport transform including cursor position
   * @returns {{ x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }}
   */
  getTransform() {
    return { ...this._state };
  }

  /**
   * Set viewport transform
   * @param {Partial<{ x: number, y: number, scale: number, cursorX: number | null, cursorY: number | null }>} newState
   */
  setTransform(newState) {
    this._setState(newState);
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    this._pointerHandler.destroy();
  }
}

export default ViewportController;