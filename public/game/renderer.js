/**
 * Game Renderer
 * Handles rendering the game state to the canvas
 */

import { drawCard, getCardDimensions, isSpritesheetLoaded } from './cards.js';
import { getCanvasContext, getCardScale, getButtonSize, getCardSpacing } from './canvas.js';
import { getColorPickerState, getHoveredCardIndex, getHoveredColorIndex, hasPlayableCard } from './input.js';
import { updateAnimations, renderAnimations, hasActiveAnimations, isDealingCards, isCardFlipping, isCardDrawing } from './cardAnimation.js';
import { hasPendingDrawAnimation, getPendingDrawHandSize, hasPendingDiscardPileCard, hasPendingPlayAnimation, hasPendingOpponentPlayAnimation, isMyTurn, isCardIndexAnimating } from './gameManager.js';

let gameState = null;
let localPlayerIndex = 0; // Which player is the local player (0-3)
let gameFinishedAt = null; // Timestamp when game finished (for delayed win message)

// Hover animation state - track offset for each card index
let cardHoverOffsets = {}; // { cardIndex: currentOffset }
const HOVER_OFFSET = -15; // How much to move card up on hover
const HOVER_ANIMATION_SPEED = 0.15; // Smooth interpolation speed

// Color picker hover animation state - track scale for each color
let colorHoverScales = {}; // { colorIndex: currentScale }
const COLOR_HOVER_SCALE = 1.15; // Target scale when hovered
const COLOR_HOVER_ANIMATION_SPEED = 0.2; // Smooth interpolation speed for color hover

// Color images
const colorImages = {
    red: null,
    green: null,
    blue: null,
    yellow: null
};
let colorImagesLoaded = false;

// UNO button image
let unoButtonImage = null;
let unoButtonLoaded = false;

// Win message box image
let winMessageBoxImage = null;
let winMessageBoxLoaded = false;

// Special card animation images
let reverseAnimationImage = null;
let skipAnimationImage = null;
let animationImagesLoaded = false;

// Finger pointing animation spritesheet
let fingerSpritesheet = null;
let fingerSpritesheetLoaded = false;
const FINGER_SPRITESHEET_WIDTH = 1010;
const FINGER_SPRITESHEET_HEIGHT = 554;
const FINGER_FRAMES_PER_ROW = 5;
const FINGER_ROWS = 2;
const FINGER_TOTAL_FRAMES = 10;
const FINGER_FRAME_WIDTH = FINGER_SPRITESHEET_WIDTH / FINGER_FRAMES_PER_ROW; // 202
const FINGER_FRAME_HEIGHT = FINGER_SPRITESHEET_HEIGHT / FINGER_ROWS; // 277
const FINGER_ANIMATION_DELAY = 3000; // 3 seconds delay before showing
let shouldDrawConditionMetAt = null; // Track when "should draw card" condition first became true

// Call UNO image
let callUnoImage = null;
let callUnoImageLoaded = false;
const UNO_CALL_DURATION = 3000; // 3 seconds to show the image
const UNO_CALL_FADE_DURATION = 500; // 500ms fade out
let unoCallAnimations = []; // Array of { playerIndex, startTime } for active UNO calls
let lastUnoCallTimes = {}; // Track last time each player called UNO (to detect every call)

// Rendering constants
// CARD_SCALE is now calculated dynamically via getCardScale() based on canvas size
// CARD_SPACING is now calculated dynamically via getCardSpacing(handSize) based on hand size
const HAND_OFFSET_Y = 20; // Offset from bottom for player's hand
const OPPONENT_OFFSET_Y = 20; // Offset from top for opponents
const CENTER_DECK_SPACING = 0; // Space between draw deck and discard pile
const VERTICAL_CARD_EDGE_SPACING = 50; // Spacing from left/right edges for vertical cards
const VERTICAL_NAME_SPACING = 40; // Space between vertical player names and their cards
// COLOR_IMAGE_SIZE is now calculated dynamically via getButtonSize() based on canvas size
// Color indicator position (relative to center)
const COLOR_IMAGE_OFFSET_X = 120; // X offset from center (positive = right)
const COLOR_IMAGE_OFFSET_Y = -35; // Y offset from center (positive = down)

// UNO button (same size as color indicator)
// UNO_BUTTON_SIZE is now calculated dynamically via getButtonSize() based on canvas size
const UNO_BUTTON_OFFSET_X = 120; // X offset from center (positive = right)
const UNO_BUTTON_OFFSET_Y = 35; // Y offset from center (positive = down, below color indicator)

// End turn button (below UNO button)
// END_TURN_BUTTON_SIZE is now calculated dynamically via getButtonSize() based on canvas size
const END_TURN_BUTTON_OFFSET_X = 120; // X offset from center (positive = right)
const END_TURN_BUTTON_OFFSET_Y = 100; // Y offset from center (positive = down, below UNO button)

/**
 * Load color indicator images
 */
export function loadColorImages() {
    return new Promise((resolve, reject) => {
        const colors = ['red', 'green', 'blue', 'yellow'];
        let loadedCount = 0;
        let hasError = false;

        colors.forEach(color => {
            const img = new Image();
            img.onload = () => {
                colorImages[color] = img;
                loadedCount++;
                if (loadedCount === colors.length && !hasError) {
                    colorImagesLoaded = true;
                    resolve();
                }
            };
            img.onerror = () => {
                console.error(`Failed to load ${color} color image`);
                hasError = true;
                reject(new Error(`Failed to load ${color} color image`));
            };
            img.src = `/assets/color/${color}.png`;
        });
    });
}

/**
 * Load UNO button image
 */
export function loadUnoButton() {
    return new Promise((resolve, reject) => {
        unoButtonImage = new Image();
        unoButtonImage.onload = () => {
            unoButtonLoaded = true;
            resolve();
        };
        unoButtonImage.onerror = () => {
            console.error('Failed to load UNO button image');
            reject(new Error('Failed to load UNO button image'));
        };
        unoButtonImage.src = '/assets/uno_button.png';
    });
}

/**
 * Load win message box image
 */
export function loadWinMessageBox() {
    return new Promise((resolve, reject) => {
        winMessageBoxImage = new Image();
        winMessageBoxImage.onload = () => {
            winMessageBoxLoaded = true;
            resolve();
        };
        winMessageBoxImage.onerror = () => {
            console.error('Failed to load win message box image');
            reject(new Error('Failed to load win message box image'));
        };
        winMessageBoxImage.src = '/assets/win_message_box.png';
    });
}

/**
 * Load special card animation images
 */
export function loadAnimationImages() {
    return new Promise((resolve, reject) => {
        let loadedCount = 0;
        let hasError = false;

        // Load reverse animation image
        reverseAnimationImage = new Image();
        reverseAnimationImage.onload = () => {
            loadedCount++;
            // Reverse animation image loaded
            if (loadedCount === 4 && !hasError) {
                animationImagesLoaded = true;
                resolve();
            }
        };
        reverseAnimationImage.onerror = () => {
            console.error('Failed to load reverse animation image');
            hasError = true;
            reject(new Error('Failed to load reverse animation image'));
        };
        reverseAnimationImage.src = '/assets/animations/change_clockwise.png';

        // Load skip animation image
        skipAnimationImage = new Image();
        skipAnimationImage.onload = () => {
            loadedCount++;
            // Skip animation image loaded
            if (loadedCount === 4 && !hasError) {
                animationImagesLoaded = true;
                resolve();
            }
        };
        skipAnimationImage.onerror = () => {
            console.error('Failed to load skip animation image');
            hasError = true;
            reject(new Error('Failed to load skip animation image'));
        };
        skipAnimationImage.src = '/assets/animations/stop_turn.png';

        // Load finger pointing animation spritesheet
        fingerSpritesheet = new Image();
        fingerSpritesheet.onload = () => {
            fingerSpritesheetLoaded = true; // Set independently
            loadedCount++;
            // Finger spritesheet loaded successfully
            if (loadedCount === 4 && !hasError) {
                animationImagesLoaded = true;
                resolve();
            }
        };
        fingerSpritesheet.onerror = (error) => {
            console.error('❌ Failed to load finger spritesheet:', error);
            console.error('Image src:', fingerSpritesheet.src);
            hasError = true;
            reject(new Error('Failed to load finger spritesheet'));
        };
        fingerSpritesheet.src = '/assets/animations/finger.png';

        // Load call UNO image
        callUnoImage = new Image();
        callUnoImage.onload = () => {
            callUnoImageLoaded = true; // Set independently
            loadedCount++;
            // Call UNO image loaded
            if (loadedCount === 4 && !hasError) {
                animationImagesLoaded = true;
                resolve();
            }
        };
        callUnoImage.onerror = () => {
            console.error('Failed to load call UNO image');
            hasError = true;
            reject(new Error('Failed to load call UNO image'));
        };
        callUnoImage.src = '/assets/call_uno.png';
    });
}

/**
 * Set the game state to render
 * @param {Object} state - Game state from server
 * @param {number} playerIndex - Index of the local player
 */
export function setGameState(state, playerIndex = 0) {
    // Track when game finishes for delayed win message
    if (state.status === 'finished' && gameState && gameState.status !== 'finished') {
        gameFinishedAt = Date.now();
    } else if (state.status !== 'finished') {
        gameFinishedAt = null; // Reset if game is no longer finished
    }
    
    // Detect when a player calls UNO (hasUno changes from false to true)
    // We need to compare against the PREVIOUS state before this update
    // Use a snapshot of the old state before updating gameState
    const oldGameState = gameState;
    
    if (state && state.players) {
        state.players.forEach((player, index) => {
            if (!player) return;
            
            const hasUnoNow = player.hasUno === true;
            // Check the OLD state (before this update) to see if they had UNO before
            const hadUnoBefore = (oldGameState && oldGameState.players && oldGameState.players[index]) 
                ? (oldGameState.players[index].hasUno === true) 
                : false;
            
            // If player just called UNO (changed from false to true)
            if (hasUnoNow && !hadUnoBefore) {
                const now = Date.now();
                const lastCallTime = lastUnoCallTimes[index] || 0;
                
                // Debounce to avoid duplicates (100ms window)
                if (now - lastCallTime > 100) {
                    unoCallAnimations.push({
                        playerIndex: index,
                        startTime: now
                    });
                    lastUnoCallTimes[index] = now;
                    // UNO call animation triggered
                }
            }
        });
    }
    
    gameState = state;
    localPlayerIndex = playerIndex;
}

/**
 * Get current game state (for input handler)
 */
export function getGameState() {
    return gameState;
}

/**
 * Manually trigger UNO call animation for a player
 * This is called optimistically when the local player calls UNO
 * @param {number} playerIndex - Index of the player who called UNO
 */
export function triggerUnoCallAnimation(playerIndex) {
    const now = Date.now();
    const lastCallTime = lastUnoCallTimes[playerIndex] || 0;
    if (now - lastCallTime > 100) { // At least 100ms between detections
        unoCallAnimations.push({
            playerIndex: playerIndex,
            startTime: now
        });
        lastUnoCallTimes[playerIndex] = now;
    }
}

/**
 * Get animation images (for card animations)
 */
export function getAnimationImages() {
    return {
        reverse: reverseAnimationImage,
        skip: skipAnimationImage,
        loaded: animationImagesLoaded
    };
}

/**
 * Get color images (for color change animations)
 */
export function getColorImages() {
    return {
        red: colorImages.red,
        green: colorImages.green,
        blue: colorImages.blue,
        yellow: colorImages.yellow,
        loaded: colorImagesLoaded
    };
}

/**
 * Get finger spritesheet (for pointing animation)
 */
export function getFingerSpritesheet() {
    return {
        image: fingerSpritesheet,
        loaded: fingerSpritesheetLoaded,
        frameWidth: FINGER_FRAME_WIDTH,
        frameHeight: FINGER_FRAME_HEIGHT,
        framesPerRow: FINGER_FRAMES_PER_ROW,
        totalFrames: FINGER_TOTAL_FRAMES
    };
}

/**
 * Calculate position and rotation for UNO call image based on player position
 * @param {number} playerIndex - Index of the player who called UNO
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {number} cardWidth - Card width
 * @param {number} cardHeight - Card height
 * @returns {Object} Position and rotation info { x, y, rotation }
 */
function getUnoCallImagePosition(playerIndex, width, height, cardWidth, cardHeight, imageSize) {
    const playerCount = gameState.players.length;
    const centerX = width / 2;
    const centerY = height / 2;
    const offsetFromEdge = 20; // Distance from player's hand
    
    if (playerCount === 2) {
        if (playerIndex === localPlayerIndex) {
            // Bottom player - no rotation, image above hand
            return {
                x: centerX - imageSize / 2,
                y: height - HAND_OFFSET_Y - cardHeight - imageSize - offsetFromEdge,
                rotation: 0
            };
        } else {
            // Top player - rotate 180 degrees, image below hand
            return {
                x: centerX - imageSize / 2,
                y: OPPONENT_OFFSET_Y + cardHeight + offsetFromEdge,
                rotation: Math.PI
            };
        }
    } else if (playerCount === 3) {
        const opponents = [];
        for (let i = 0; i < 3; i++) {
            if (i !== localPlayerIndex) {
                opponents.push(i);
            }
        }
        
        if (playerIndex === localPlayerIndex) {
            // Bottom player - no rotation
            return {
                x: centerX - imageSize / 2,
                y: height - HAND_OFFSET_Y - cardHeight - imageSize - offsetFromEdge,
                rotation: 0
            };
        } else if (playerIndex === opponents[0]) {
            // Top opponent - rotate 180 degrees
            return {
                x: centerX - imageSize / 2,
                y: OPPONENT_OFFSET_Y + cardHeight + offsetFromEdge,
                rotation: Math.PI
            };
        } else if (playerIndex === opponents[1]) {
            // Left opponent - rotate 90 degrees clockwise
            return {
                x: VERTICAL_CARD_EDGE_SPACING + cardWidth + offsetFromEdge,
                y: centerY - imageSize / 2,
                rotation: Math.PI / 2
            };
        } else {
            // Fallback - should not reach here
            // Unexpected player index in 3-player mode
            return {
                x: centerX - imageSize / 2,
                y: centerY - imageSize / 2,
                rotation: 0
            };
        }
    } else if (playerCount === 4) {
        const opponents = [];
        for (let i = 0; i < 4; i++) {
            if (i !== localPlayerIndex) {
                opponents.push(i);
            }
        }
        
        if (playerIndex === localPlayerIndex) {
            // Bottom player - no rotation
            return {
                x: centerX - imageSize / 2,
                y: height - HAND_OFFSET_Y - cardHeight - imageSize - offsetFromEdge,
                rotation: 0
            };
        } else if (playerIndex === opponents[0]) {
            // Top opponent - rotate 180 degrees
            return {
                x: centerX - imageSize / 2,
                y: OPPONENT_OFFSET_Y + cardHeight + offsetFromEdge,
                rotation: Math.PI
            };
        } else if (playerIndex === opponents[1]) {
            // Right opponent - rotate 90 degrees counter-clockwise
            return {
                x: width - VERTICAL_CARD_EDGE_SPACING - cardWidth - imageSize - offsetFromEdge,
                y: centerY - imageSize / 2,
                rotation: -Math.PI / 2
            };
        } else {
            // Left opponent - rotate 90 degrees clockwise
            return {
                x: VERTICAL_CARD_EDGE_SPACING + cardWidth + offsetFromEdge,
                y: centerY - imageSize / 2,
                rotation: Math.PI / 2
            };
        }
    }
    
    // Default fallback
    return { x: centerX, y: centerY, rotation: 0 };
}

/**
 * Render UNO call images for all active animations
 */
function renderUnoCallImages(ctx, width, height, cardWidth, cardHeight) {
    if (!callUnoImageLoaded || !callUnoImage) {
        return;
    }
    
    const now = Date.now();
    const imageSize = getButtonSize() * 2;
    
    // Filter out expired animations and render active ones
    unoCallAnimations = unoCallAnimations.filter(anim => {
        const elapsed = now - anim.startTime;
        const totalDuration = UNO_CALL_DURATION + UNO_CALL_FADE_DURATION;
        
        if (elapsed >= totalDuration) {
            return false; // Remove expired animation
        }
        
        // Calculate opacity (fade out in last 500ms)
        let opacity = 1.0;
        if (elapsed > UNO_CALL_DURATION) {
            const fadeProgress = (elapsed - UNO_CALL_DURATION) / UNO_CALL_FADE_DURATION;
            opacity = 1.0 - fadeProgress;
        }
        
        // Get position and rotation for this player (pass imageSize so positions are calculated correctly)
        const pos = getUnoCallImagePosition(anim.playerIndex, width, height, cardWidth, cardHeight, imageSize);
        
        // Draw the image with rotation and opacity
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(pos.x + imageSize / 2, pos.y + imageSize / 2);
        ctx.rotate(pos.rotation);
        ctx.drawImage(
            callUnoImage,
            -imageSize / 2,
            -imageSize / 2,
            imageSize,
            imageSize
        );
        ctx.restore();
        
        return true; // Keep this animation
    });
}

/**
 * Render finger pointing animation above the deck
 * Shows when player should draw a card (it's their turn, no playable cards, after 3 second delay)
 */
function renderFingerAnimation(ctx, deckX, deckY, cardWidth, cardHeight) {
    // Debug: Log that function is being called
    const debugInfo = {
        spritesheetLoaded: fingerSpritesheetLoaded,
        gameStatus: gameState?.status,
        isMyTurn: gameState?.currentPlayerIndex === localPlayerIndex,
        hasTopCard: !!gameState?.topCard,
        hasCurrentColor: !!gameState?.currentColor,
        timerSet: !!shouldDrawConditionMetAt
    };
    
    // Only log every 2 seconds to avoid spam
    const now = Date.now();
    if (!window.lastFingerDebugLog || (now - window.lastFingerDebugLog) > 2000) {
        // Finger animation check
        window.lastFingerDebugLog = now;
    }
    
    // Check if spritesheet is loaded
    if (!fingerSpritesheetLoaded || !fingerSpritesheet) {
        if (shouldDrawConditionMetAt) {
            // Finger animation blocked: spritesheet not loaded
        }
        return;
    }
    
    // Basic checks
    if (!gameState || gameState.status !== 'playing') {
        shouldDrawConditionMetAt = null;
        return;
    }
    
    // Don't show if player is waiting for UNO (cannot draw)
    if (gameState.waitingForUno === true) {
        shouldDrawConditionMetAt = null;
        return;
    }
    
    // Must be local player's turn
    if (gameState.currentPlayerIndex !== localPlayerIndex) {
        shouldDrawConditionMetAt = null;
        return;
    }
    
    // Need topCard and currentColor to check for playable cards
    if (!gameState.topCard || !gameState.currentColor) {
        if (shouldDrawConditionMetAt) {
            // Finger animation blocked: no topCard or currentColor
        }
        shouldDrawConditionMetAt = null;
        return;
    }
    
    const localPlayer = gameState.players[localPlayerIndex];
    if (!localPlayer || !localPlayer.hand || localPlayer.hand.length === 0) {
        shouldDrawConditionMetAt = null;
        return;
    }
    
    // Check if player has any playable cards
    const hasPlayable = hasPlayableCard(localPlayer.hand, gameState.topCard, gameState.currentColor);
    
    if (hasPlayable) {
        shouldDrawConditionMetAt = null;
        return; // Don't show if player has playable cards
    }
    
    // All conditions met - player should draw a card
    // Track when this condition first became true
    if (!shouldDrawConditionMetAt) {
        shouldDrawConditionMetAt = Date.now();
        // Finger animation timer started
    }
    
    // Check if 3 seconds have passed since condition became true
    const elapsed = Date.now() - shouldDrawConditionMetAt;
    if (elapsed < FINGER_ANIMATION_DELAY) {
        return; // Still waiting for delay
    }
    
    // Log first time animation shows
    if (elapsed < FINGER_ANIMATION_DELAY + 200) { // Within 200ms of trigger
        // Finger animation now showing
    }
    
    // Calculate animation frame based on time (looping)
    const currentFrameCalcNow = Date.now();
    const frameDuration = 100; // 100ms per frame (10 FPS)
    const currentFrame = Math.floor((currentFrameCalcNow / frameDuration) % FINGER_TOTAL_FRAMES);
    
    // Calculate position above the deck
    const cardScale = getCardScale();
    const fingerSize = cardWidth * 0.5; // Much smaller, responsive size based on card width
    const fingerX = deckX + cardWidth / 2 - fingerSize / 2;
    const fingerY = deckY - fingerSize - -10; // Position above deck with spacing
    
    // Calculate source rectangle in spritesheet
    const row = Math.floor(currentFrame / FINGER_FRAMES_PER_ROW);
    const col = currentFrame % FINGER_FRAMES_PER_ROW;
    const sourceX = col * FINGER_FRAME_WIDTH;
    const sourceY = row * FINGER_FRAME_HEIGHT;
    
    // Draw the current frame
    ctx.drawImage(
        fingerSpritesheet,
        sourceX, sourceY, FINGER_FRAME_WIDTH, FINGER_FRAME_HEIGHT,
        fingerX, fingerY, fingerSize, fingerSize * (FINGER_FRAME_HEIGHT / FINGER_FRAME_WIDTH)
    );
}

/**
 * Render the entire game
 */
export function render() {
    if (!gameState || !isSpritesheetLoaded()) {
        return;
    }

    // Update animations
    updateAnimations();

    const { ctx, width, height } = getCanvasContext();
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;

    // Render based on player count (hands will show as cards are added during dealing)
    const playerCount = gameState.players.length;

    if (playerCount === 2) {
        render2Players(ctx, width, height, cardWidth, cardHeight);
    } else if (playerCount === 3) {
        render3Players(ctx, width, height, cardWidth, cardHeight);
    } else if (playerCount === 4) {
        render4Players(ctx, width, height, cardWidth, cardHeight);
    }
    
    // Render animations on top of everything
    if (hasActiveAnimations()) {
        renderAnimations(ctx);
    }
}

/**
 * Render only the deck (during dealing)
 */
function renderDeckOnly(ctx, width, height, cardWidth, cardHeight) {
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Render draw deck (always visible, even when empty)
    if (gameState.deck) {
        const totalWidth = (cardWidth * 2);
        const drawDeckX = centerX - totalWidth / 2;
        const deckY = centerY - cardHeight / 2;
        
        drawCard(ctx, 'wild', 'back', drawDeckX, deckY, cardWidth, cardHeight);
        
        // Draw deck count (show 0 when empty)
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${gameState.deck.length || 0}`, drawDeckX + cardWidth / 2, deckY + cardHeight + 15);
    }
    
    // Show "Dealing cards..." message
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Dealing cards...', width / 2, height / 2 + 100);
}

/**
 * Render game for 2 players
 */
function render2Players(ctx, width, height, cardWidth, cardHeight) {
    // Top: Opponent
    // Center: Draw deck + Discard pile
    // Bottom: Local player

    const opponentIndex = (localPlayerIndex + 1) % 2;
    const opponent = gameState.players[opponentIndex];
    const localPlayer = gameState.players[localPlayerIndex];

    // Render opponent hand (top, face down)
    renderOpponentHand(ctx, opponent, width, OPPONENT_OFFSET_Y, cardWidth, cardHeight, opponentIndex);

    // Render center area (draw deck + discard pile)
    const centerX = width / 2;
    const centerY = height / 2;
    renderCenterArea(ctx, centerX, centerY, cardWidth, cardHeight);
    
    // Render color indicator (positioned independently)
    renderColorIndicator(ctx, centerX, centerY);
    
    // Render UNO button (positioned independently, below color indicator)
    renderUnoButton(ctx, centerX, centerY);
    
    // Render end turn button (if player has drawn a playable card)
    if (gameState && gameState.hasDrawnPlayableCard && isMyTurn()) {
        renderEndTurnButton(ctx, centerX, centerY);
    }

    // Render local player hand (bottom, face up)
    renderPlayerHand(ctx, localPlayer, width, height - HAND_OFFSET_Y - cardHeight, cardWidth, cardHeight, localPlayerIndex);

    // Render game info
    renderGameInfo(ctx, width, height, cardWidth, cardHeight);
    
    // Render UNO call images
    renderUnoCallImages(ctx, width, height, cardWidth, cardHeight);
}

/**
 * Render game for 3 players
 */
function render3Players(ctx, width, height, cardWidth, cardHeight) {
    // Top: Opponent 1
    // Left: Opponent 2 (rotated/vertical)
    // Center: Discard pile
    // Bottom: Local player

    const opponents = [];
    for (let i = 0; i < 3; i++) {
        if (i !== localPlayerIndex) {
            opponents.push({ index: i, player: gameState.players[i] });
        }
    }

    // Top opponent
    renderOpponentHand(ctx, opponents[0].player, width, OPPONENT_OFFSET_Y, cardWidth, cardHeight, opponents[0].index);

    // Left opponent (vertical cards) - centered vertically
    const leftX = VERTICAL_CARD_EDGE_SPACING;
    const leftY = height / 2;
    renderOpponentHandVertical(ctx, opponents[1].player, leftX, leftY, cardWidth, cardHeight, opponents[1].index, true);

    // Center area (draw deck + discard pile)
    const centerX = width / 2;
    const centerY = height / 2;
    renderCenterArea(ctx, centerX, centerY, cardWidth, cardHeight);
    
    // Render color indicator (positioned independently)
    renderColorIndicator(ctx, centerX, centerY);
    
    // Render UNO button (positioned independently, below color indicator)
    renderUnoButton(ctx, centerX, centerY);
    
    // Render end turn button (if player has drawn a playable card)
    if (gameState && gameState.hasDrawnPlayableCard && isMyTurn()) {
        renderEndTurnButton(ctx, centerX, centerY);
    }

    // Local player (bottom)
    const localPlayer = gameState.players[localPlayerIndex];
    renderPlayerHand(ctx, localPlayer, width, height - HAND_OFFSET_Y - cardHeight, cardWidth, cardHeight, localPlayerIndex);

    // Render game info
    renderGameInfo(ctx, width, height, cardWidth, cardHeight);
    
    // Render UNO call images
    renderUnoCallImages(ctx, width, height, cardWidth, cardHeight);
}

/**
 * Render game for 4 players
 */
function render4Players(ctx, width, height, cardWidth, cardHeight) {
    // Top: Opponent 1
    // Right: Opponent 2 (vertical)
    // Bottom: Local player
    // Left: Opponent 3 (vertical)
    // Center: Discard pile

    const opponents = [];
    for (let i = 0; i < 4; i++) {
        if (i !== localPlayerIndex) {
            opponents.push({ index: i, player: gameState.players[i] });
        }
    }

    // Top opponent
    renderOpponentHand(ctx, opponents[0].player, width, OPPONENT_OFFSET_Y, cardWidth, cardHeight, opponents[0].index);

    // Right opponent (vertical) - centered vertically
    // When rotated, cardWidth becomes the vertical dimension, so use cardWidth for positioning
    const rightX = width - VERTICAL_CARD_EDGE_SPACING - cardWidth;
    const rightY = height / 2;
    renderOpponentHandVertical(ctx, opponents[1].player, rightX, rightY, cardWidth, cardHeight, opponents[1].index, false);

    // Left opponent (vertical) - centered vertically
    const leftX = VERTICAL_CARD_EDGE_SPACING;
    const leftY = height / 2;
    renderOpponentHandVertical(ctx, opponents[2].player, leftX, leftY, cardWidth, cardHeight, opponents[2].index, true);

    // Center area (draw deck + discard pile)
    const centerX = width / 2;
    const centerY = height / 2;
    renderCenterArea(ctx, centerX, centerY, cardWidth, cardHeight);
    
    // Render color indicator (positioned independently)
    renderColorIndicator(ctx, centerX, centerY);
    
    // Render UNO button (positioned independently, below color indicator)
    renderUnoButton(ctx, centerX, centerY);
    
    // Render end turn button (if player has drawn a playable card)
    if (gameState && gameState.hasDrawnPlayableCard && isMyTurn()) {
        renderEndTurnButton(ctx, centerX, centerY);
    }

    // Local player (bottom)
    const localPlayer = gameState.players[localPlayerIndex];
    renderPlayerHand(ctx, localPlayer, width, height - HAND_OFFSET_Y - cardHeight, cardWidth, cardHeight, localPlayerIndex);

    // Render game info
    renderGameInfo(ctx, width, height, cardWidth, cardHeight);
    
    // Render UNO call images
    renderUnoCallImages(ctx, width, height, cardWidth, cardHeight);
}

/**
 * Render player's hand (face up cards at bottom)
 */
function renderPlayerHand(ctx, player, canvasWidth, y, cardWidth, cardHeight, playerIndex) {
    const handSize = player.hand.length;
    if (handSize === 0) return;

    // Calculate total width and starting position
    const cardSpacing = getCardSpacing(handSize);
    const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    let startX = (canvasWidth - totalWidth) / 2;

    // Get hovered card index and update hover animation (only for local player)
    const hoveredIndex = (playerIndex === localPlayerIndex) ? getHoveredCardIndex() : null;
    
    // Update hover animation for all cards (only for local player)
    if (playerIndex === localPlayerIndex) {
        // Initialize offsets for all cards if not already set
        player.hand.forEach((card, index) => {
            if (cardHoverOffsets[index] === undefined) {
                cardHoverOffsets[index] = 0;
            }
        });
        
        // Update each card's hover offset
        player.hand.forEach((card, index) => {
            const targetOffset = (index === hoveredIndex) ? HOVER_OFFSET : 0;
            // Smooth interpolation for hover effect
            cardHoverOffsets[index] += (targetOffset - cardHoverOffsets[index]) * HOVER_ANIMATION_SPEED;
        });
        
        // Clean up offsets for cards that no longer exist (if hand size decreased)
        Object.keys(cardHoverOffsets).forEach(key => {
            const index = parseInt(key);
            if (index >= handSize) {
                delete cardHoverOffsets[index];
            }
        });
    }

    // Draw each card
    player.hand.forEach((card, index) => {
        // Skip rendering card if it's currently being drawn or flipped (animation will show it)
        if (isCardDrawing(card) || isCardFlipping(card)) {
            return;
        }
        
        // Skip rendering card if it's being animated (for draw 2/4 animations)
        if (isCardIndexAnimating(playerIndex, index)) {
            return;
        }
        
        // If there's a pending draw animation for local player, skip the last card
        // (it's being animated and will appear after animation completes)
        if (playerIndex === localPlayerIndex && hasPendingDrawAnimation()) {
            const pendingHandSize = getPendingDrawHandSize();
            if (pendingHandSize !== null && index === pendingHandSize - 1) {
                return; // Skip the last card - it's being animated
            }
        }
        
        const cardX = startX + (index * (cardWidth + cardSpacing));
        // Apply hover offset for this specific card
        const cardOffset = (playerIndex === localPlayerIndex && cardHoverOffsets[index] !== undefined) 
            ? cardHoverOffsets[index] 
            : 0;
        const cardY = y + cardOffset;
        drawCard(ctx, card.color, card.value, cardX, cardY, cardWidth, cardHeight);
    });

    // Draw player name, card count, and timer
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    
    // Check if it's this player's turn and show timer
    const isCurrentPlayer = gameState && gameState.currentPlayerIndex === playerIndex;
    const showTimer = gameState && gameState.status === 'playing' && isCurrentPlayer;
    const timeRemaining = (showTimer && gameState.turnTimeRemaining !== null && gameState.turnTimeRemaining !== undefined) 
        ? gameState.turnTimeRemaining 
        : null;
    
    if (timeRemaining !== null && timeRemaining > 0) {
        // Add timer to the name
        let timerColor = '#ffffff';
        if (timeRemaining <= 5) {
            timerColor = '#ff0000'; // Red when time is running out
        } else if (timeRemaining <= 10) {
            timerColor = '#ffaa00'; // Orange when getting low
        } else {
            timerColor = '#ffff00'; // Yellow for normal countdown
        }
        
        const namePart = `${player.name} (${handSize} cards) - `;
        const timerPart = `${timeRemaining}s`;
        
        // Measure text to center it properly
        ctx.textAlign = 'left';
        const nameWidth = ctx.measureText(namePart).width;
        const timerWidth = ctx.measureText(timerPart).width;
        const totalWidth = nameWidth + timerWidth;
        const startX = (canvasWidth - totalWidth) / 2;
        
        // Draw name part
        ctx.fillStyle = '#ffffff';
        ctx.fillText(namePart, startX, y - 10);
        
        // Draw timer part in color
        ctx.fillStyle = timerColor;
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(timerPart, startX + nameWidth, y - 10);
    } else {
        ctx.textAlign = 'center';
        ctx.fillText(`${player.name} (${handSize} cards)`, canvasWidth / 2, y - 10);
    }
}

/**
 * Render opponent's hand (face down cards)
 */
function renderOpponentHand(ctx, player, canvasWidth, y, cardWidth, cardHeight, playerIndex) {
    const handSize = player.hand.length;
    if (handSize === 0) return;

    // Calculate total width and starting position (centered)
    const cardSpacing = getCardSpacing(handSize);
    const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    const startX = (canvasWidth - totalWidth) / 2;

    // Draw each card face down
    for (let i = 0; i < handSize; i++) {
        // Skip rendering card if it's being animated (for draw 2/4 animations)
        if (isCardIndexAnimating(playerIndex, i)) {
            continue;
        }
        
        const cardX = startX + (i * (cardWidth + cardSpacing));
        drawCard(ctx, 'wild', 'back', cardX, y, cardWidth, cardHeight);
    }

    // Draw player name, card count, and timer
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    
    // Check if it's this player's turn and show timer
    const isCurrentPlayer = gameState && gameState.currentPlayerIndex === playerIndex;
    const showTimer = gameState && gameState.status === 'playing' && isCurrentPlayer;
    const timeRemaining = (showTimer && gameState.turnTimeRemaining !== null && gameState.turnTimeRemaining !== undefined) 
        ? gameState.turnTimeRemaining 
        : null;
    
    if (timeRemaining !== null && timeRemaining > 0) {
        // Add timer to the name
        let timerColor = '#ffffff';
        if (timeRemaining <= 5) {
            timerColor = '#ff0000'; // Red when time is running out
        } else if (timeRemaining <= 10) {
            timerColor = '#ffaa00'; // Orange when getting low
        } else {
            timerColor = '#ffff00'; // Yellow for normal countdown
        }
        
        const namePart = `${player.name} (${handSize} cards) - `;
        const timerPart = `${timeRemaining}s`;
        
        // Measure text to center it properly
        ctx.textAlign = 'left';
        const nameWidth = ctx.measureText(namePart).width;
        const timerWidth = ctx.measureText(timerPart).width;
        const totalWidth = nameWidth + timerWidth;
        const startX = (canvasWidth - totalWidth) / 2;
        
        // Draw name part
        ctx.fillStyle = '#ffffff';
        ctx.fillText(namePart, startX, y + cardHeight + 20);
        
        // Draw timer part in color
        ctx.fillStyle = timerColor;
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(timerPart, startX + nameWidth, y + cardHeight + 20);
    } else {
        ctx.textAlign = 'center';
        ctx.fillText(`${player.name} (${handSize} cards)`, canvasWidth / 2, y + cardHeight + 20);
    }
}

/**
 * Render opponent's hand vertically (for side players)
 */
function renderOpponentHandVertical(ctx, player, x, centerY, cardWidth, cardHeight, playerIndex, isLeftSide = true) {
    const handSize = player.hand.length;
    if (handSize === 0) return;

    // When rotated 90 degrees, cardWidth becomes the vertical dimension
    // So we use cardWidth for spacing calculation to match horizontal overlap
    const cardSpacing = getCardSpacing(handSize);
    const totalHeight = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    // Center the cards vertically around centerY
    let y = centerY - totalHeight / 2;

    // Draw cards vertically
    for (let i = 0; i < handSize; i++) {
        // Skip rendering card if it's being animated (for draw 2/4 animations)
        if (isCardIndexAnimating(playerIndex, i)) {
            continue;
        }
        
        const cardY = y + (i * (cardWidth + cardSpacing));
        
        // Rotate and draw card
        // When rotated, cardWidth becomes the vertical dimension, so use cardWidth for Y center
        // Left side: rotate 90 degrees clockwise (Math.PI / 2) so top faces center
        // Right side: rotate 90 degrees counter-clockwise (-Math.PI / 2) so top faces center
        ctx.save();
        ctx.translate(x + cardWidth / 2, cardY + cardWidth / 2);
        ctx.rotate(isLeftSide ? Math.PI / 2 : -Math.PI / 2);
        drawCard(ctx, 'wild', 'back', -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
        ctx.restore();
    }

    // Draw player name and card count next to the cards (rotated)
    // Left side: name on the right of cards, rotated 90 degrees clockwise
    // Right side: name on the left of cards, rotated 90 degrees counter-clockwise
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (isLeftSide) {
        // Left side: rotate 90 degrees clockwise, position on right
        ctx.translate(x + cardWidth + VERTICAL_NAME_SPACING, centerY);
        ctx.rotate(Math.PI / 2);
    } else {
        // Right side: rotate 90 degrees counter-clockwise, position on left
        ctx.translate(x - VERTICAL_NAME_SPACING, centerY);
        ctx.rotate(-Math.PI / 2);
    }
    
    // Check if it's this player's turn and show timer
    const isCurrentPlayer = gameState && gameState.currentPlayerIndex === playerIndex;
    const showTimer = gameState && gameState.status === 'playing' && isCurrentPlayer;
    const timeRemaining = (showTimer && gameState.turnTimeRemaining !== null && gameState.turnTimeRemaining !== undefined) 
        ? gameState.turnTimeRemaining 
        : null;
    
    if (timeRemaining !== null && timeRemaining > 0) {
        // Add timer to the name
        let timerColor = '#ffffff';
        if (timeRemaining <= 5) {
            timerColor = '#ff0000'; // Red when time is running out
        } else if (timeRemaining <= 10) {
            timerColor = '#ffaa00'; // Orange when getting low
        } else {
            timerColor = '#ffff00'; // Yellow for normal countdown
        }
        
        const namePart = `${player.name} (${handSize} cards) - `;
        const timerPart = `${timeRemaining}s`;
        
        // Measure text to center it properly (in rotated coordinate system)
        ctx.textAlign = 'left';
        const nameWidth = ctx.measureText(namePart).width;
        const timerWidth = ctx.measureText(timerPart).width;
        const totalWidth = nameWidth + timerWidth;
        const startX = -totalWidth / 2; // Center around 0,0 in rotated space
        
        // Draw name part
        ctx.fillStyle = '#ffffff';
        ctx.fillText(namePart, startX, 0);
        
        // Draw timer part in color
        ctx.fillStyle = timerColor;
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(timerPart, startX + nameWidth, 0);
    } else {
        ctx.textAlign = 'center';
        ctx.fillText(`${player.name} (${handSize} cards)`, 0, 0);
    }
    
    ctx.restore();
}

/**
 * Render center area (draw deck + discard pile)
 */
function renderCenterArea(ctx, centerX, centerY, cardWidth, cardHeight) {
    // Calculate positions - draw deck on left, discard pile on right (centered)
    const totalWidth = (cardWidth * 2) + CENTER_DECK_SPACING;
    const drawDeckX = centerX - totalWidth / 2;
    const discardPileX = centerX + totalWidth / 2 - cardWidth;
    const y = centerY - cardHeight / 2;

    // Render draw deck (face down) - always visible, even when empty
    if (gameState.deck) {
        drawCard(ctx, 'wild', 'back', drawDeckX, y, cardWidth, cardHeight);
        
        // Draw deck count (show 0 when empty)
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${gameState.deck.length || 0}`, drawDeckX + cardWidth / 2, y + cardHeight + 15);
        
        // Render finger pointing animation if player has no playable cards and it's their turn
        // Only show animation when deck has cards (can't draw from empty deck)
        if (gameState.deck.length > 0) {
            renderFingerAnimation(ctx, drawDeckX, y, cardWidth, cardHeight);
        }
    }

    // Render discard pile (top card) - but NOT while dealing cards
    // Only render discard pile card if it exists and we're not dealing cards
    // For pending discard pile card (first card), don't render (animation handles it)
    // For pending play animations (local or opponent), still show the OLD card (new card is handled by animation)
    if (gameState.topCard && !isDealingCards() && !hasPendingDiscardPileCard()) {
        // Check if this card is currently being animated (first discard pile card)
        const isAnimated = isCardDrawing(gameState.topCard) || isCardFlipping(gameState.topCard);
        if (!isAnimated) {
            // Render the card - even if there's a pending play animation, this is the old card
            // The new card being played will be rendered by the animation system
            drawCard(ctx, gameState.topCard.color, gameState.topCard.value, discardPileX, y, cardWidth, cardHeight);
        }
    }
}

/**
 * Render current color indicator (positioned independently)
 * Only shows when there's a card on the discard pile
 */
function renderColorIndicator(ctx, centerX, centerY) {
    // Only render color indicator if there's a top card (discard pile has been started)
    if (gameState.topCard && gameState.currentColor && colorImagesLoaded && colorImages[gameState.currentColor]) {
        const buttonSize = getButtonSize();
        const colorImageX = centerX + COLOR_IMAGE_OFFSET_X - buttonSize / 2;
        const colorImageY = centerY + COLOR_IMAGE_OFFSET_Y - buttonSize / 2;
        
        ctx.drawImage(
            colorImages[gameState.currentColor],
            colorImageX,
            colorImageY,
            buttonSize,
            buttonSize
        );
    }
}

/**
 * Render UNO button (positioned independently, below color indicator)
 */
function renderUnoButton(ctx, centerX, centerY) {
    if (unoButtonLoaded && unoButtonImage) {
        const buttonSize = getButtonSize();
        const unoButtonX = centerX + UNO_BUTTON_OFFSET_X - buttonSize / 2;
        const unoButtonY = centerY + UNO_BUTTON_OFFSET_Y - buttonSize / 2;
        
        // Check if UNO button should be available
        // Available when: it's local player's turn, they have 1 card, haven't called UNO, AND waitingForUno is true
        // (waitingForUno is only true when they played a card and went from 2+ to 1 card)
        const isAvailable = gameState && 
                           gameState.status === 'playing' &&
                           gameState.currentPlayerIndex === localPlayerIndex &&
                           gameState.players[localPlayerIndex] &&
                           gameState.players[localPlayerIndex].hand.length === 1 &&
                           !gameState.players[localPlayerIndex].hasUno &&
                           gameState.waitingForUno === true;
        
        // Set opacity: 0.5 when unavailable, 1.0 when available
        ctx.save();
        ctx.globalAlpha = isAvailable ? 1.0 : 0.5;
        
        ctx.drawImage(
            unoButtonImage,
            unoButtonX,
            unoButtonY,
            buttonSize,
            buttonSize
        );
        
        ctx.restore();
    }
}

/**
 * Render end turn button (shown when player has drawn a playable card)
 */
function renderEndTurnButton(ctx, centerX, centerY) {
    const buttonSize = getButtonSize();
    const buttonX = centerX + END_TURN_BUTTON_OFFSET_X - buttonSize / 2;
    const buttonY = centerY + END_TURN_BUTTON_OFFSET_Y - buttonSize / 2;
    
    // Draw button background
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(buttonX, buttonY, buttonSize, buttonSize);
    
    // Draw button border
    ctx.strokeStyle = '#2E7D32';
    ctx.lineWidth = 2;
    ctx.strokeRect(buttonX, buttonY, buttonSize, buttonSize);
    
    // Draw text (scale font size proportionally)
    const fontSize = Math.max(10, Math.round(buttonSize * 0.2));
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('END', centerX + END_TURN_BUTTON_OFFSET_X, centerY + END_TURN_BUTTON_OFFSET_Y - fontSize / 2);
    ctx.fillText('TURN', centerX + END_TURN_BUTTON_OFFSET_X, centerY + END_TURN_BUTTON_OFFSET_Y + fontSize / 2);
}

/**
 * Render return to lobby button (shown inside win message box)
 */
function renderReturnToLobbyButton(ctx, width, height, boxX, boxY, boxWidth, boxHeight, scaleFactor) {
    // Button size - proportional to box size
    const buttonWidth = boxWidth * 0.7; // 70% of box width
    const buttonHeight = boxHeight * 0.25; // 25% of box height
    const buttonX = boxX + (boxWidth - buttonWidth) / 2; // Centered horizontally in box
    const buttonY = boxY + boxHeight * 0.6; // Position in lower portion of box
    
    // Draw button background (purple)
    ctx.fillStyle = '#9C27B0'; // Purple color
    ctx.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);
    
    // Draw button border
    ctx.strokeStyle = '#7B1FA2'; // Darker purple for border
    ctx.lineWidth = 2;
    ctx.strokeRect(buttonX, buttonY, buttonWidth, buttonHeight);
    
    // Draw text (scale font size proportionally)
    const fontSize = Math.max(14, Math.round(18 * scaleFactor));
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BACK TO LOBBY', boxX + boxWidth / 2, buttonY + buttonHeight / 2);
}

/**
 * Render game info (current turn, draw count, etc.)
 */
function renderGameInfo(ctx, width, height, cardWidth, cardHeight) {
    const infoY = height * 0.15;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';

    // Game status - show win message 2 seconds after game finishes
    if (gameState.status === 'finished' && gameState.winner !== null) {
        const winner = gameState.players[gameState.winner];
        const isLocalPlayerWinner = gameState.winner === localPlayerIndex;
        
        // Don't show win message if:
        // - Local player won and their play animation is still pending
        // - Opponent won and their play animation is still pending
        // - Less than 2 seconds have passed since game finished
        const shouldDelayWinMessage = (isLocalPlayerWinner && hasPendingPlayAnimation()) ||
                                     (!isLocalPlayerWinner && hasPendingOpponentPlayAnimation());
        
        const hasDelayedEnough = gameFinishedAt !== null && (Date.now() - gameFinishedAt) >= 2000;
        
        if (!shouldDelayWinMessage && hasDelayedEnough && winMessageBoxLoaded && winMessageBoxImage) {
            // Calculate responsive size for win message box (based on canvas width)
            const baseWidth = 400; // Base width for large screens
            const baseHeight = 200; // Base height for large screens
            const scaleFactor = Math.min(width / 1200, 1.2); // Scale based on canvas width, max 1.2x
            const boxWidth = baseWidth * scaleFactor;
            const boxHeight = baseHeight * scaleFactor;
            
            // Center position
            const boxX = width / 2 - boxWidth / 2;
            const boxY = height / 2 - boxHeight / 2;
            
            // Draw win message box image
            ctx.drawImage(winMessageBoxImage, boxX, boxY, boxWidth, boxHeight);
            
            // Draw text on top of the box (centered, scaled proportionally)
            const fontSize = Math.max(20, Math.round(24 * scaleFactor));
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${winner.name} WINS!`, width / 2, boxY + boxHeight * 0.35); // Position text in upper third of box
            
            // Render return to lobby button inside the win message box
            renderReturnToLobbyButton(ctx, width, height, boxX, boxY, boxWidth, boxHeight, scaleFactor);
        }
    }

    // Deck count
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Deck: ${gameState.deck.length} cards`, width - 100, height - 20);
    
    // Render color picker if visible
    renderColorPicker(ctx);
}

/**
 * Render color picker for wild card selection
 */
function renderColorPicker(ctx) {
    const pickerState = getColorPickerState();
    if (!pickerState.visible) {
        // Clean up hover scales when color picker is hidden
        colorHoverScales = {};
        return;
    }
    
    const { width, height } = getCanvasContext();
    const pickerSize = 50;
    const spacing = 10;
    const colors = ['red', 'green', 'blue', 'yellow'];
    const colorMap = {
        'red': '#ff0000',
        'green': '#00ff00',
        'blue': '#0000ff',
        'yellow': '#ffff00'
    };
    
    const { x, y } = pickerState.position;
    const startX = x - (pickerSize + spacing);
    const startY = y - (pickerSize + spacing);
    
    // Get hovered color index for hover effect
    const hoveredColorIndex = getHoveredColorIndex();
    
    // Update hover animation for all colors with smooth interpolation
    for (let i = 0; i < colors.length; i++) {
        // Initialize scale if not already set
        if (colorHoverScales[i] === undefined) {
            colorHoverScales[i] = 1.0;
        }
        
        // Calculate target scale (hovered = larger, not hovered = normal)
        const targetScale = (i === hoveredColorIndex) ? COLOR_HOVER_SCALE : 1.0;
        
        // Smooth interpolation for hover effect
        colorHoverScales[i] += (targetScale - colorHoverScales[i]) * COLOR_HOVER_ANIMATION_SPEED;
    }
    
    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);
    
    // Draw color options in 2x2 grid
    for (let i = 0; i < colors.length; i++) {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const baseColorX = startX + col * (pickerSize + spacing);
        const baseColorY = startY + row * (pickerSize + spacing);
        
        // Get current interpolated scale for smooth animation
        const scale = colorHoverScales[i] || 1.0;
        const scaledSize = pickerSize * scale;
        const offsetX = (scaledSize - pickerSize) / 2;
        const offsetY = (scaledSize - pickerSize) / 2;
        const colorX = baseColorX - offsetX;
        const colorY = baseColorY - offsetY;
        const centerX = colorX + scaledSize / 2;
        const centerY = colorY + scaledSize / 2;
        const radius = scaledSize / 2;
        
        // Draw color circle with smooth hover effect
        ctx.fillStyle = colorMap[colors[i]];
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    // Draw instruction text
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Choose a color', x, startY - 20);
}

