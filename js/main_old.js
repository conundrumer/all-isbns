import { contentToScreen, screenToContent } from './Transform.js';
import ViewportController from './ViewportController.js';

// Setup canvas and context
const container = document.getElementById('container');
/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Virtual canvas size (the size of our content)
const contentWidth = 5_000;
const contentHeight = 4_000;

let displayWidth, displayHeight;

// Get device pixel ratio
let pixelRatio = window.devicePixelRatio || 1;

// Set canvas size accounting for DPI
function resizeCanvas() {
    // Update pixel ratio in case of screen change
    pixelRatio = window.devicePixelRatio || 1;

    // Set canvas size in CSS pixels
    displayWidth = container.clientWidth;
    displayHeight = container.clientHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    // Set canvas internal size accounting for DPI
    canvas.width = Math.floor(displayWidth * pixelRatio);
    canvas.height = Math.floor(displayHeight * pixelRatio);

    // Scale the context to account for DPI
    ctx.scale(pixelRatio, pixelRatio);

    return { width: displayWidth, height: displayHeight };
}

// Calculate transform to center content with given scale
function calculateCenterTransform(containerWidth, containerHeight, scale) {
    return {
        x: (containerWidth - contentWidth * scale) / 2,
        y: (containerHeight - contentHeight * scale) / 2,
        scale
    };
}

// Calculate transform that preserves the center point during resize
function calculatePreservedCenterTransform(oldState, oldWidth, oldHeight, newWidth, newHeight) {
    // Find the content coordinates of the center of the viewport before resize
    const oldCenter = screenToContent([oldWidth / 2, oldHeight / 2], oldState);

    // Calculate what screen coordinates that center point should have in the new viewport
    const newScreenCenter = [newWidth / 2, newHeight / 2];

    // Calculate the transform needed to position that content point at the new screen center
    return {
        x: newScreenCenter[0] - oldCenter[0] * oldState.scale,
        y: newScreenCenter[1] - oldCenter[1] * oldState.scale,
        scale: oldState.scale
    };
}

const lerp = (k, a, b) => a - k * (a - b)
const ilerp = (x, a, b) => (x - a) / (b - a)
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const ease = t => t * (2 - t)

// Draw content relative to viewport state
function drawContent(state) {
    // Clear canvas (using display size)
    ctx.clearRect(0, 0, canvas.width / pixelRatio, canvas.height / pixelRatio);

    // Apply viewport transform
    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.scale(state.scale, state.scale);

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, contentWidth, contentHeight);

    // Draw shapes
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(200, 300, 200, 200);

    ctx.fillStyle = '#4ecdc4';
    ctx.beginPath();
    ctx.arc(800, 800, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#45b7d1';
    ctx.beginPath();
    ctx.moveTo(500, 500);
    ctx.lineTo(700, 500);
    ctx.lineTo(600, 700);
    ctx.closePath();
    ctx.fill();

    // Draw grid
    ctx.lineWidth = 1 / state.scale; // Keep grid lines consistent width
    // ctx.beginPath();
    // const displayContentWidth = displayWidth / state.scale;
    // const displayContentHeight = displayHeight / state.scale;

    let [vx0, vy0] = screenToContent([0, 0], state)
    let [vx1, vy1] = screenToContent([displayWidth, displayHeight], state)
    vx1 = Math.min(vx1, 5000 - 1)
    vy1 = Math.min(vy1, 4000 - 1)

    const drawSquares2 = (x0, y0, s0, m0) => {
        const x1 = x0 + m0
        const y1 = y0 + m0
        const s1 = s0 - m0 * 2

        ctx.strokeRect(x1, y1, s1, s1)

        const k = ease(clamp(ilerp(s1 / 10 * state.scale, 50, 100)))
        // const k = ease(clamp(ilerp(s1 / 10 * state.scale, 50, 100)))

        const m1 = m0 * k

        const x2 = x1 + m1 * 0.5
        const y2 = y1 + m1 * 0.5
        const s2 = s1 - m1
        const s20 = s2 / 10 - m1

        const a = ctx.globalAlpha

        if (k > 0) {
            for (let i = 0; i < 10; i++) {
                let y = y2 + s2 / 10 * i + m1 * 0.5
                if ((y + s20) < vy0 || y > vy1) continue

                ctx.strokeRect(x2 + m1 * 0.5, y2 + s2 / 10 * i + m1 * 0.5, s2 - m1, s20)

                for (let j = 0; j < 10; j++) {
                    let x = x2 + s2 / 10 * j + m1 * 0.5
                    if ((x + s20) < vx0 || x > vx1) continue

                    drawSquares2(x, y, s20, m1)
                }
            }
        }

        const k2 = clamp(ilerp(k, 0.5, 0))
        if (k2 > 0) {
            ctx.globalAlpha = k2
            ctx.fillRect(x1, y1, s1, s1)
            ctx.globalAlpha = a
        }
    }

    ctx.lineWidth = 1 / state.scale;
    ctx.strokeStyle = 'rgb(136, 136, 136)';
    // ctx.strokeStyle = 'white';
    ctx.fillStyle = 'rgb(81, 81, 81)';
    // ctx.globalAlpha = 1;
    const m0 = 4 / state.scale
    // ctx.strokeRect(0, 0, 5_000, 4_000)
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 5; j++) {
            drawSquares2(j * 1_000, i * 1_000, 1_000, m0);
        }
    }

    ctx.globalAlpha = 1;

    ctx.restore();

    ctx.font = `8px Courier New`;
    // ctx.font = `12px Iosevka, monospace`;

    const cursorSize = 10;
    // Draw cursor indicator if cursor is in bounds
    if (state.cursorX !== null && state.cursorY !== null) {
        const [x, y] = contentToScreen([state.cursorX, state.cursorY], state);

        // Draw crosshair
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - cursorSize, y);
        ctx.lineTo(x + cursorSize, y);
        ctx.moveTo(x, y - cursorSize);
        ctx.lineTo(x, y + cursorSize);
        ctx.stroke();

        // Draw circle
        ctx.beginPath();
        ctx.arc(x, y, cursorSize / 2, 0, Math.PI * 2);
        ctx.stroke();

        // Draw coordinates
        ctx.fillStyle = 'white';
        ctx.fillText(
            `(${Math.round(state.cursorX)}, ${Math.round(state.cursorY)})`,
            x + cursorSize,
            y + cursorSize
        );
    }
    ctx.fillStyle = 'white';
    ctx.fillText(
        screenToContent([0, 0], state).map(Math.round).join(", ") + " " + state.scale.toFixed(1) + " " + Math.log10(state.scale).toFixed(1),
        cursorSize,
        1.5 * cursorSize
    );
}

// Initialize the viewport controller
const viewport = new ViewportController(container, {
    minScale: 1e-1,
    maxScale: 1e3,
    onChange: (state) => {
        drawContent(state);
    },
    onClick: (x, y) => {
        // Convert viewport coordinates to content coordinates
        const state = viewport.getTransform();
        const [contentX, contentY] = screenToContent([x, y], state);
        console.log('Content coordinates:', contentX, contentY);
    }
});

// Track previous dimensions for resize calculations
let previousWidth = 0;
let previousHeight = 0;

// Handle container resizing using ResizeObserver
const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
        if (entry.target === container) {
            // Get current state before resize
            const currentState = viewport.getTransform();

            // Get new dimensions
            const { width, height } = resizeCanvas();

            // Only calculate new transform if we have previous dimensions
            if (previousWidth && previousHeight) {
                // Calculate new transform that preserves the view center
                const newState = calculatePreservedCenterTransform(
                    currentState,
                    previousWidth,
                    previousHeight,
                    width,
                    height
                );
                viewport.setTransform(newState);
            }

            // Update previous dimensions
            previousWidth = width;
            previousHeight = height;
        }
    }
});

// Start observing container
resizeObserver.observe(container);

// Initial setup
const { width, height } = resizeCanvas();
previousWidth = width;
previousHeight = height;

// Calculate initial scale to fit content
const scale = Math.min(
    width / contentWidth * 0.8,
    height / contentHeight * 0.8
);

// Set initial transform centered at calculated scale
viewport.setTransform(calculateCenterTransform(width, height, scale));