// Card spritesheet configuration
const SPRITESHEET_WIDTH = 2028;
const SPRITESHEET_HEIGHT = 1210;
const CARDS_PER_ROW = 13; // For rows 1-4
const TOTAL_ROWS = 5;

// Calculate card dimensions
const CARD_WIDTH = SPRITESHEET_WIDTH / CARDS_PER_ROW; // ~156px per card for rows 1-4
const CARD_HEIGHT = SPRITESHEET_HEIGHT / TOTAL_ROWS; // 242px per row

// Card colors mapping
const COLORS = ['red', 'green', 'blue', 'yellow'];
const COLOR_INDICES = {
    'red': 0,
    'green': 1,
    'blue': 2,
    'yellow': 3
};

// Card values for rows 1-4 (0-9, skip, reverse, draw2)
const CARD_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];

// Row 5 special cards
const SPECIAL_CARDS = ['wild', 'draw4', 'back'];

let spritesheet = null;
let spritesheetLoaded = false;

/**
 * Load the card spritesheet
 */
export function loadCardSpritesheet() {
    return new Promise((resolve, reject) => {
        spritesheet = new Image();
        spritesheet.onload = () => {
            spritesheetLoaded = true;
            resolve();
        };
        spritesheet.onerror = () => {
            console.error('Failed to load card spritesheet');
            reject(new Error('Failed to load card spritesheet'));
        };
        spritesheet.src = '/assets/cards/cards.png';
    });
}

/**
 * Get sprite coordinates for a card
 * @param {string} color - 'red', 'green', 'blue', 'yellow', or 'wild' for special cards
 * @param {string} value - Card value ('0'-'9', 'skip', 'reverse', 'draw2', 'wild', 'draw4', 'back')
 * @returns {Object} { sx, sy, width, height } - Source coordinates and dimensions
 */
export function getCardSprite(color, value) {
    if (!spritesheetLoaded || !spritesheet) {
        console.error('Spritesheet not loaded');
        return null;
    }

    // Handle special cards (row 5)
    // Row 5 has 3 cards (wild, draw4, back) at positions 0, 1, 2
    // They use the same CARD_WIDTH as other rows, just positioned at the start
    if (value === 'wild' || value === 'draw4' || value === 'back') {
        const rowIndex = 4; // Row 5 (0-indexed)
        const specialIndex = SPECIAL_CARDS.indexOf(value);
        
        if (specialIndex === -1) {
            console.error(`Invalid special card: ${value}`);
            return null;
        }

        // Row 5 cards are the same size as other cards, positioned at indices 0, 1, 2
        // wild at x=0, draw4 at x=CARD_WIDTH, back at x=2*CARD_WIDTH
        const sx = specialIndex * CARD_WIDTH;
        const sy = rowIndex * CARD_HEIGHT;

        return {
            sx,
            sy,
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            image: spritesheet
        };
    }

    // Handle colored cards (rows 1-4)
    if (!COLORS.includes(color)) {
        console.error(`Invalid color: ${color}`);
        return null;
    }

    const rowIndex = COLOR_INDICES[color];
    const valueIndex = CARD_VALUES.indexOf(value);

    if (valueIndex === -1) {
        console.error(`Invalid card value: ${value}`);
        return null;
    }

    const sx = valueIndex * CARD_WIDTH;
    const sy = rowIndex * CARD_HEIGHT;

    return {
        sx,
        sy,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        image: spritesheet
    };
}

/**
 * Draw a card on the canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} color - Card color
 * @param {string} value - Card value
 * @param {number} x - Destination x position
 * @param {number} y - Destination y position
 * @param {number} width - Destination width (optional, defaults to card width)
 * @param {number} height - Destination height (optional, defaults to card height)
 */
export function drawCard(ctx, color, value, x, y, width = null, height = null) {
    const sprite = getCardSprite(color, value);
    if (!sprite) return;

    const destWidth = width || sprite.width;
    const destHeight = height || sprite.height;

    ctx.drawImage(
        sprite.image,
        sprite.sx,
        sprite.sy,
        sprite.width,
        sprite.height,
        x,
        y,
        destWidth,
        destHeight
    );
}

/**
 * Check if spritesheet is loaded
 */
export function isSpritesheetLoaded() {
    return spritesheetLoaded;
}

/**
 * Get card dimensions
 */
export function getCardDimensions() {
    return {
        width: CARD_WIDTH,
        height: CARD_HEIGHT
    };
}

