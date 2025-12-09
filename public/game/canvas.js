// Canvas setup and rendering

let canvas;
let ctx;
let canvasWidth;
let canvasHeight;
let bgImage = null;
let bgImageLoaded = false;
let gameRenderFunction = null;

/**
 * Initialize the canvas - sets up responsive sizing and context
 */
export function initCanvas() {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    ctx = canvas.getContext('2d');
    
    // Load background image
    loadBackgroundImage();
    
    // Set initial size
    resizeCanvas();
    
    // Handle window resize
    window.addEventListener('resize', resizeCanvas);
    
    // Start render loop
    render();
}

/**
 * Load the background image
 */
function loadBackgroundImage() {
    bgImage = new Image();
    bgImage.onload = () => {
        bgImageLoaded = true;
    };
    bgImage.onerror = () => {
        console.error('Failed to load background image');
    };
    bgImage.src = '/assets/bg_game.jpg';
}

/**
 * Resize canvas to fit container while maintaining aspect ratio
 */
function resizeCanvas() {
    const container = canvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Target aspect ratio (can be adjusted later)
    const targetAspectRatio = 16 / 9;
    
    // Scale factor - use more of available space (was 0.6, now 0.9)
    const scaleFactor = 0.75;
    
    let newWidth, newHeight;
    
    if (containerWidth / containerHeight > targetAspectRatio) {
        // Container is wider than target ratio
        newHeight = containerHeight * scaleFactor;
        newWidth = newHeight * targetAspectRatio;
    } else {
        // Container is taller than target ratio
        newWidth = containerWidth * scaleFactor;
        newHeight = newWidth / targetAspectRatio;
    }
    
    // Scale context for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = newWidth * dpr;
    canvas.height = newHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = newWidth + 'px';
    canvas.style.height = newHeight + 'px';
    
    // Update internal dimensions
    canvasWidth = newWidth;
    canvasHeight = newHeight;
}

/**
 * Set the game render function
 * @param {Function} renderFn - Function to call for game rendering
 */
export function setGameRenderFunction(renderFn) {
    gameRenderFunction = renderFn;
}

/**
 * Main render loop
 */
function render() {
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw background image if loaded
    if (bgImageLoaded && bgImage) {
        // Draw background image to fill entire canvas
        ctx.drawImage(bgImage, 0, 0, canvasWidth, canvasHeight);
    }
    
    // Render game (if active)
    if (gameRenderFunction) {
        gameRenderFunction();
    }
    
    // Continue render loop
    requestAnimationFrame(render);
}

/**
 * Get canvas context (for use in other modules)
 */
export function getCanvasContext() {
    return { canvas, ctx, width: canvasWidth, height: canvasHeight };
}

/**
 * Calculate responsive card scale based on canvas size
 * Returns 0.52 for large screens, scales down for smaller screens
 * @returns {number} Card scale factor (between 0.35 and 0.52)
 */
export function getCardScale() {
    const { width, height } = getCanvasContext();
    // Use the smaller dimension to ensure cards fit on all screen sizes
    const minDimension = Math.min(width, height);
    
    // Base scale for large screens (0.52)
    const maxScale = 0.6;
    // Minimum scale for very small screens
    const minScale = 0.35;
    
    // Breakpoints: scale down below 1200px width
    const largeScreenWidth = 1200;
    const smallScreenWidth = 600;
    
    if (width >= largeScreenWidth) {
        return maxScale;
    } else if (width <= smallScreenWidth) {
        return minScale;
    } else {
        // Linear interpolation between small and large screens
        const ratio = (width - smallScreenWidth) / (largeScreenWidth - smallScreenWidth);
        return minScale + (maxScale - minScale) * ratio;
    }
}

/**
 * Calculate responsive button/image size based on canvas size
 * Returns 60 for large screens, scales down for smaller screens
 * @returns {number} Button size in pixels (between 35 and 60)
 */
export function getButtonSize() {
    const { width, height } = getCanvasContext();
    
    // Base size for large screens (60)
    const maxSize = 65;
    // Minimum size for very small screens
    const minSize = 40;
    
    // Breakpoints: scale down below 1200px width
    const largeScreenWidth = 1200;
    const smallScreenWidth = 600;
    
    if (width >= largeScreenWidth) {
        return maxSize;
    } else if (width <= smallScreenWidth) {
        return minSize;
    } else {
        // Linear interpolation between small and large screens
        const ratio = (width - smallScreenWidth) / (largeScreenWidth - smallScreenWidth);
        return minSize + (maxSize - minSize) * ratio;
    }
}

/**
 * Calculate card spacing (overlap) based on hand size
 * More cards = more overlap to fit them on screen
 * @param {number} handSize - Number of cards in hand
 * @returns {number} Card spacing (negative value for overlap)
 */
export function getCardSpacing(handSize) {
    // Base spacing for 10 cards or less
    if (handSize <= 10) {
        return -40;
    } else if (handSize <= 15) {
        // More overlap for 11-15 cards
        return -50;
    } else {
        // Even more overlap for 16+ cards
        return -55;
    }
}

