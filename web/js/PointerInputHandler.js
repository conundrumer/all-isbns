/**
 * @typedef {Object} PointerData
 * @property {string} pointerType - Type of pointer ('mouse', 'touch', or 'pen')
 * @property {number} pointerId - Unique identifier for the pointer
 * @property {boolean} isPrimary - Whether this is the primary pointer
 * @property {number} x - X coordinate of the pointer
 * @property {number} y - Y coordinate of the pointer
 * @property {number} [button] - Button number that was pressed (for pointer down/up events)
 * @property {number} [buttons] - Bit field representing currently pressed buttons (for move/drag events)
 * @export
 */

/**
 * @typedef {Object} WheelData
 * @property {number} x - X coordinate of the wheel event
 * @property {number} y - Y coordinate of the wheel event
 * @property {number} deltaX - Horizontal scroll amount
 * @property {number} deltaY - Vertical scroll amount
 * @property {boolean} trackpad - Whether the event came from a trackpad
 * @property {boolean} pinch - Whether the event came from pinching on a trackpad
 * @export
 */

/**
 * @typedef {Object} PointerInputOptions
 * @property {(data: PointerData) => void} [onPointerDown] - Handler for pointer down events
 * @property {(data: PointerData) => void} [onPointerUp] - Handler for pointer up events
 * @property {(data: PointerData) => void} [onPointerMove] - Handler for pointer move events
 * @property {(data: PointerData) => void} [onPointerDrag] - Handler for pointer drag events
 * @property {(data: PointerData) => void} [onPointerHover] - Handler for pointer hover events
 * @property {(data: WheelData) => void} [onWheel] - Handler for wheel events
 */

class PointerInputHandler {
  /** @type {HTMLElement} */
  _container;

  /** @type {PointerInputOptions} */
  _options;

  /** @type {number} */
  _downCount = 0;

  /** @type {number|null} */
  _primaryPointerId = null;

  /** @type {number} */
  _prevButtons = 0;

  /** @type {number} */
  _deltaX = 0;

  /** @type {number} */
  _deltaY = 0;

  /** @type {boolean|null} */
  _scroll2D = null;

  /** @type {Map<number, Function>} */
  _throttledDragHandlers = new Map();

  /** @type {Function} */
  _throttledHover;

  /** @type {Function} */
  _throttledWheel;

  /**
   * @param {HTMLElement} container - The DOM element to attach pointer events to
   * @param {PointerInputOptions} [options={}] - Configuration options
   */
  constructor(container, options = {}) {
    this._container = container;
    this._options = {
      onPointerDown: () => {},
      onPointerUp: () => {},
      onPointerMove: () => {},
      onPointerDrag: () => {},
      onPointerHover: () => {},
      onWheel: () => {},
      ...options
    };

    // Setup throttled handlers for non-pointer-specific events
    this._throttledHover = this._rafThrottle(this._options.onPointerHover);
    this._throttledWheel = this._rafThrottle(this._handleThrottledWheel);

    this._init();
  }

  /**
   * Initialize event listeners and container styles
   * @private
   */
  _init() {
    this._container.addEventListener('pointerdown', this._handlePointerDown);
    this._container.addEventListener('pointermove', this._handlePointerMove);
    this._container.addEventListener('wheel', this._handleWheel, { passive: false });
    window.addEventListener('pointercancel', this._handlePointerUp);
    this._container.addEventListener('contextmenu', e => e.preventDefault());
  }

  /**
   * Clean up event listeners and throttled handlers
   */
  destroy() {
    this._container.removeEventListener('pointerdown', this._handlePointerDown);
    this._container.removeEventListener('pointermove', this._handlePointerMove);
    this._container.removeEventListener('wheel', this._handleWheel);
    window.removeEventListener('pointermove', this._handlePointerMove);
    window.removeEventListener('pointerup', this._handlePointerUp);
    window.removeEventListener('pointercancel', this._handlePointerUp);

    // Clean up all throttled handlers
    for (const pointerId of this._throttledDragHandlers.keys()) {
      this._cleanupThrottledDragHandler(pointerId);
    }
  }

  /**
   * RAF-based throttle function
   * @private
   * @template {(...args: any[]) => void} T
   * @param {T} fn - Function to throttle
   * @returns {T & { flush: () => void }} Throttled function with flush method
   */
  _rafThrottle(fn) {
    let rafId = null;
    let nextArgs = null;

    function invoke() {
      if (nextArgs) {
        fn(...nextArgs);
        nextArgs = null
      }
      rafId = null;
    }

    const throttled = (...args) => {
      nextArgs = args;
      if (rafId == null) {
        invoke();
        nextArgs = null
        rafId = requestAnimationFrame(invoke);
      }
    };

    throttled.flush = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        invoke();
      }
    };

    return throttled;
  }

  /**
   * Get or create a throttled drag handler for a specific pointer
   * @private
   * @param {number} pointerId - The pointer ID to get a handler for
   * @returns {Function} The throttled handler for this pointer
   */
  _getThrottledDragHandler(pointerId) {
    if (!this._throttledDragHandlers.has(pointerId)) {
      const handler = this._rafThrottle((data) => {
        // Only process events for this specific pointer
        if (data.pointerId === pointerId) {
          this._options.onPointerDrag(data);
        }
      });
      this._throttledDragHandlers.set(pointerId, handler);
    }
    return this._throttledDragHandlers.get(pointerId);
  }

  /**
   * Clean up the throttled handler for a specific pointer
   * @private
   * @param {number} pointerId - The pointer ID to clean up
   */
  _cleanupThrottledDragHandler(pointerId) {
    const handler = this._throttledDragHandlers.get(pointerId);
    if (handler) {
      handler.flush(); // Ensure any pending updates are processed
      this._throttledDragHandlers.delete(pointerId);
    }
  }

  /**
   * Check if a specific button is pressed in the buttons bitmask
   * @private
   * @param {number} button - Button index
   * @param {number} buttons - Buttons bitmask
   * @returns {boolean}
   */
  _isButtonPressed(button, buttons) {
    const buttonToButtons = [1, 4, 2, 8, 16, 32];
    return !!(buttonToButtons[button] & buttons);
  }

  /**
   * Check if the pointer event is from the primary pointer
   * @private
   * @param {PointerEvent} e - Pointer event
   * @returns {boolean}
   */
  _isPrimary(e) {
    return e.pointerId === this._primaryPointerId;
  }

  /**
   * Normalize pointer events for touch and pen input
   * @private
   * @param {PointerEvent} e - Pointer event to normalize
   * @returns {PointerEvent}
   */
  _normalizePointerEvent(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      return new Proxy(e, {
        get(target, prop) {
          if (prop === 'buttons') {
            return 1;
          }
          return target[prop];
        }
      });
    }
    return e;
  }

  /**
   * Handle initial pointer down state
   * @private
   * @param {PointerEvent} e - Pointer event
   */
  _handleInitialPointerDown(e) {
    if (this._downCount === 0) {
      this._primaryPointerId = e.pointerId;
      window.addEventListener('pointermove', this._handlePointerMove);
      window.addEventListener('pointerup', this._handlePointerUp);
    }
    this._downCount++;
  }

  /**
   * Handle final pointer up state
   * @private
   * @param {PointerEvent} e - Pointer event
   */
  _handleFinalPointerUp(e) {
    this._downCount = Math.max(0, this._downCount - 1);

    if (e.pointerId === this._primaryPointerId) {
      this._primaryPointerId = null;
    }

    if (this._downCount === 0) {
      window.removeEventListener('pointermove', this._handlePointerMove);
      window.removeEventListener('pointerup', this._handlePointerUp);
    }
  }
  /**
   * Handle pointer down events
   * @private
   * @param {PointerEvent} e - Pointer event
   */
  _handlePointerDown = (e) => {
    e.preventDefault();
    const normalizedEvent = this._normalizePointerEvent(e);

    this._handleInitialPointerDown(normalizedEvent);
    this._throttledHover.flush();

    const pointerData = {
      pointerType: normalizedEvent.pointerType,
      pointerId: normalizedEvent.pointerId,
      isPrimary: this._isPrimary(normalizedEvent),
      button: normalizedEvent.button,
      x: normalizedEvent.clientX,
      y: normalizedEvent.clientY
    };

    this._options.onPointerDown(pointerData);
    this._prevButtons = normalizedEvent.buttons;
  }

  /**
   * Handle pointer up events
   * @private
   * @param {PointerEvent} e - Pointer event
   */
  _handlePointerUp = (e) => {
    e.preventDefault();
    const normalizedEvent = this._normalizePointerEvent(e);

    this._cleanupThrottledDragHandler(e.pointerId);

    const pointerData = {
      pointerType: normalizedEvent.pointerType,
      pointerId: normalizedEvent.pointerId,
      isPrimary: this._isPrimary(normalizedEvent),
      button: normalizedEvent.button,
      x: normalizedEvent.clientX,
      y: normalizedEvent.clientY
    };

    this._options.onPointerUp(pointerData);
    this._handleFinalPointerUp(normalizedEvent);
    this._prevButtons = normalizedEvent.buttons;
  }

  /**
   * Handle pointer move events
   * @private
   * @param {PointerEvent} e - Pointer event
   */
  _handlePointerMove = (e) => {
    e.preventDefault();
    const normalizedEvent = this._normalizePointerEvent(e);
    const isPrimary = this._isPrimary(normalizedEvent);

    const pointerData = {
      pointerType: normalizedEvent.pointerType,
      pointerId: normalizedEvent.pointerId,
      isPrimary,
      x: normalizedEvent.clientX,
      y: normalizedEvent.clientY,
      buttons: normalizedEvent.buttons
    };

    if (normalizedEvent.buttons === this._prevButtons) {
      if (normalizedEvent.buttons === 0) {
        this._throttledHover(pointerData);
      } else {
        // Get the throttled handler for this specific pointer
        const throttledDrag = this._getThrottledDragHandler(normalizedEvent.pointerId);
        throttledDrag(pointerData);
      }
    } else {
      // Handle button state changes during move
      for (let button = 0; button < 3; button++) {
        const pressed = this._isButtonPressed(button, normalizedEvent.buttons);
        const prevPressed = this._isButtonPressed(button, this._prevButtons);

        if (!prevPressed && pressed) {
          this._options.onPointerDown({ ...pointerData, button });
        } else if (prevPressed && !pressed) {
          this._options.onPointerUp({ ...pointerData, button });
        }
      }

      if (normalizedEvent.buttons === 0) {
        this._handleFinalPointerUp(normalizedEvent);
      }
    }

    this._prevButtons = normalizedEvent.buttons;
  }
  /**
   * Handle throttled wheel events
   * @private
   * @param {WheelEvent} e - Wheel event
   */
  _handleThrottledWheel = (e) => {
    const wheelData = {
      x: e.clientX,
      y: e.clientY,
      deltaX: this._deltaX,
      // normalize conventional scroll wheels
      deltaY: this._deltaY * (this._scroll2D ? 1 : [0.25, 20, 1][e.deltaMode]),
      trackpad: this._scroll2D,
      // chrome pinch-to-zoom sets ctrlKey
      pinch: e.ctrlKey
    };

    this._options.onWheel(wheelData);
    this._deltaX = 0;
    this._deltaY = 0;
  }

  /**
   * Handle wheel events
   * @private
   * @param {WheelEvent} e - Wheel event
   */
  _handleWheel = (e) => {
    e.preventDefault();

    this._deltaX += e.deltaX;
    this._deltaY += e.deltaY;

    // Detect trackpad
    if (this._scroll2D === null && e.deltaX !== 0 && e.deltaY !== 0) {
      this._scroll2D = true;
    }

    this._throttledWheel(e);
  }
}

export default PointerInputHandler;