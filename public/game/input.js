/**
 * Input Handler
 * Handles mouse/touch interactions for playing cards, drawing cards, and calling UNO
 */

import { getCanvasContext, getCardScale, getButtonSize, getCardSpacing } from './canvas.js';
import { getCardDimensions } from './cards.js';
import { playCardFromHand, drawCardForPlayer, callUnoForPlayer, endTurnForPlayer, isMyTurn, canPlayOrDraw, getCurrentGameState } from './gameManager.js';
import { getGameState as getRendererState } from './renderer.js';

// Constants
// CARD_SCALE is now calculated dynamically via getCardScale() based on canvas size
let localPlayerIndex = 0;
let gameState = null;

// Color picker state
let showColorPicker = false;
let colorPickerPosition = { x: 0, y: 0 };
let pendingCardIndex = null;

// Card hover state
let hoveredCardIndex = null;
let hoveredCardY = 0; // Current Y offset for smooth animation

// Color picker hover state
let hoveredColorIndex = null;

/**
 * Initialize input handling
 * @param {number} playerIndex - Index of local player
 */
export function initInput(playerIndex = 0) {
    localPlayerIndex = playerIndex;
    const { canvas } = getCanvasContext();
    
    if (!canvas) {
        // Canvas not found for input handling
        return;
    }
    
    // Add click event listener
    canvas.addEventListener('click', handleCanvasClick);
    // Add mouse move listener for hover effects
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
    canvas.style.cursor = 'pointer';
    
    // Update game state reference
    updateGameState();
}

/**
 * Update game state reference
 */
export function updateGameState() {
    gameState = getCurrentGameState();
}

/**
 * Handle canvas mouse move for hover effects
 */
function handleCanvasMouseMove(event) {
    if (!gameState) {
        return;
    }
    
    const { canvas, width, height } = getCanvasContext();
    const rect = canvas.getBoundingClientRect();
    
    // Get mouse position relative to canvas
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to match canvas logical dimensions
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    // Check if color picker is visible and handle hover
    if (showColorPicker) {
        const colorIndex = checkColorPickerHover(scaledX, scaledY);
        if (colorIndex !== hoveredColorIndex) {
            hoveredColorIndex = colorIndex;
        }
    } else {
        hoveredColorIndex = null;
    }
    
    // Check if hovering over a card in player's hand
    const cardIndex = checkPlayerCardHover(scaledX, scaledY);
    
    if (cardIndex !== hoveredCardIndex) {
        hoveredCardIndex = cardIndex;
    }
}

/**
 * Handle canvas mouse leave
 */
function handleCanvasMouseLeave() {
    hoveredCardIndex = null;
    hoveredColorIndex = null;
}

/**
 * Check if mouse is hovering over a card in player's hand
 * @returns {number|null} Card index if hovering, null otherwise
 */
function checkPlayerCardHover(x, y) {
    if (!gameState || !gameState.players[localPlayerIndex]) {
        return null;
    }
    
    const { width, height } = getCanvasContext();
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    const player = gameState.players[localPlayerIndex];
    const handSize = player.hand.length;
    
    if (handSize === 0) return null;
    
    const cardSpacing = getCardSpacing(handSize);
    
    // Calculate card positions (same as renderer)
    const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    const startX = (width - totalWidth) / 2;
    const handY = height - 20 - cardHeight; // HAND_OFFSET_Y = 20
    
    // Check each card (check from right to left since cards overlap)
    for (let i = handSize - 1; i >= 0; i--) {
        const cardX = startX + (i * (cardWidth + cardSpacing));
        
        const cardLeft = cardX;
        const cardRight = cardX + cardWidth;
        const cardTop = handY;
        const cardBottom = handY + cardHeight;
        
        // Check if mouse is within this card's bounds
        if (x >= cardLeft && x <= cardRight && y >= cardTop && y <= cardBottom) {
            // For overlapping cards, check if we're in the non-overlapping portion
            const overlapAmount = Math.abs(cardSpacing);
            const uniqueRight = i === handSize - 1 ? cardRight : cardRight - overlapAmount;
            
            // If mouse is in the unique portion of this card, or it's the rightmost card
            if (x <= uniqueRight || i === handSize - 1) {
                return i;
            }
        }
    }
    
    return null;
}

/**
 * Get hovered card index (for renderer)
 */
export function getHoveredCardIndex() {
    return hoveredCardIndex;
}

/**
 * Handle canvas click
 */
function handleCanvasClick(event) {
    const { canvas, width, height } = getCanvasContext();
    const rect = canvas.getBoundingClientRect();
    
    // Get click position relative to canvas
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Scale coordinates to match canvas logical dimensions
    // Canvas CSS size should match logical size, but account for any scaling
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    // Get current game state
    const currentGameState = getCurrentGameState();
    
    // Debug: Log all clicks when game is finished
    if (currentGameState && currentGameState.status === 'finished') {
        // Canvas clicked when game finished
    }
    
    // Check return to lobby button click (only when game is finished)
    // This should be checked first, before other turn-based checks
    if (currentGameState && currentGameState.status === 'finished') {
        const buttonClicked = checkReturnToLobbyButtonClick(scaledX, scaledY);
        // Button click check
        
        if (buttonClicked) {
            // Return to lobby button clicked
            // Return to lobby
            if (window.returnToLobby) {
                window.returnToLobby();
            } else {
                // window.returnToLobby is not defined
            }
            return;
        }
        // If game is finished, don't process any other clicks
        return;
    }
    
    // Update local gameState reference
    updateGameState();
    
    // For all other interactions, require game to be playing and player's turn
    if (!gameState || !isMyTurn()) {
        return;
    }
    
    // Debug: log coordinates (remove after testing)
    // console.log('Click:', { x, y, scaledX, scaledY, rectWidth: rect.width, rectHeight: rect.height, width, height });
    
    // Check if color picker is visible
    if (showColorPicker) {
        const colorClicked = checkColorPickerClick(scaledX, scaledY);
        if (colorClicked) {
            // Play the pending card with selected color
            const result = playCardFromHand(pendingCardIndex, colorClicked);
            if (result.success) {
                hideColorPicker();
                updateGameState();
            }
            return;
        } else {
            // Clicked outside color picker, hide it
            hideColorPicker();
        }
    }
    
    // If waiting for UNO, only allow clicking UNO button
    // Get fresh state to ensure we have the latest waitingForUno flag
    if (currentGameState && currentGameState.waitingForUno === true) {
        // Check UNO button click (only if available)
        if (checkUnoButtonClick(scaledX, scaledY)) {
            // Only allow clicking if UNO is available (it's your turn, you have 1 card, and haven't called UNO)
            const isAvailable = currentGameState && 
                               currentGameState.status === 'playing' &&
                               currentGameState.currentPlayerIndex === localPlayerIndex &&
                               currentGameState.players[localPlayerIndex] &&
                               currentGameState.players[localPlayerIndex].hand.length === 1 &&
                               !currentGameState.players[localPlayerIndex].hasUno;
            
            if (isAvailable) {
                const result = callUnoForPlayer();
                if (result.success) {
                    updateGameState();
                }
            }
        }
        // Block all other clicks when waiting for UNO
        return;
    }
    
    // Check draw deck click (only if can play or draw)
    if (canPlayOrDraw() && checkDrawDeckClick(scaledX, scaledY)) {
        // Check if player has playable cards - they can only draw if they don't
        const player = gameState.players[localPlayerIndex];
        if (player && player.hand && player.hand.length > 0) {
            const hasPlayable = hasPlayableCard(player.hand, gameState.topCard, gameState.currentColor);
            if (hasPlayable && !gameState.hasDrawnPlayableCard) {
                // You have a playable card. You must play a card before drawing.
                return;
            }
        }
        
        const result = drawCardForPlayer();
        if (result.success) {
            updateGameState();
        }
        return;
    }
    
    // Check end turn button click (shown when player has drawn a playable card)
    if (gameState.hasDrawnPlayableCard && checkEndTurnButtonClick(scaledX, scaledY)) {
        const result = endTurnForPlayer();
        if (result.success) {
            updateGameState();
        }
        return;
    }
    
    // Check UNO button click (only if available)
    if (checkUnoButtonClick(scaledX, scaledY)) {
        const gameStateForUno = getCurrentGameState();
        // Only allow clicking if UNO is available (it's your turn, you have 1 card, haven't called UNO, AND waitingForUno is true)
        const isAvailable = gameStateForUno && 
                           gameStateForUno.status === 'playing' &&
                           gameStateForUno.currentPlayerIndex === localPlayerIndex &&
                           gameStateForUno.players[localPlayerIndex] &&
                           gameStateForUno.players[localPlayerIndex].hand.length === 1 &&
                           !gameStateForUno.players[localPlayerIndex].hasUno &&
                           gameStateForUno.waitingForUno === true;
        
        if (isAvailable) {
            const result = callUnoForPlayer();
            if (result.success) {
                updateGameState();
            }
        }
        return;
    }
    
    // Check card click in player's hand (only if can play or draw)
    if (canPlayOrDraw()) {
        const cardIndex = checkPlayerCardClick(scaledX, scaledY);
        if (cardIndex !== null) {
            handleCardClick(cardIndex);
        }
    }
}

/**
 * Check if draw deck was clicked
 */
function checkDrawDeckClick(x, y) {
    const { width, height } = getCanvasContext();
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    // Draw deck is on the left side of center
    const centerX = width / 2;
    const centerY = height / 2;
    const totalWidth = (cardWidth * 2);
    const drawDeckX = centerX - totalWidth / 2;
    const deckY = centerY - cardHeight / 2;
    
    return x >= drawDeckX && x <= drawDeckX + cardWidth &&
           y >= deckY && y <= deckY + cardHeight;
}

/**
 * Check if end turn button was clicked
 */
function checkEndTurnButtonClick(x, y) {
    const { width, height } = getCanvasContext();
    const centerX = width / 2;
    const centerY = height / 2;
    
    // End turn button position (near UNO button)
    const BUTTON_SIZE = getButtonSize();
    const BUTTON_OFFSET_X = 120;
    const BUTTON_OFFSET_Y = 100; // Below UNO button
    
    const buttonX = centerX + BUTTON_OFFSET_X - BUTTON_SIZE / 2;
    const buttonY = centerY + BUTTON_OFFSET_Y - BUTTON_SIZE / 2;
    
    return x >= buttonX && x <= buttonX + BUTTON_SIZE &&
           y >= buttonY && y <= buttonY + BUTTON_SIZE;
}

/**
 * Check if UNO button was clicked
 */
function checkUnoButtonClick(x, y) {
    const { width, height } = getCanvasContext();
    const centerX = width / 2;
    const centerY = height / 2;
    
    // UNO button position (from renderer constants)
    const UNO_BUTTON_SIZE = getButtonSize();
    const UNO_BUTTON_OFFSET_X = 120;
    const UNO_BUTTON_OFFSET_Y = 35;
    
    const buttonX = centerX + UNO_BUTTON_OFFSET_X - UNO_BUTTON_SIZE / 2;
    const buttonY = centerY + UNO_BUTTON_OFFSET_Y - UNO_BUTTON_SIZE / 2;
    
    return x >= buttonX && x <= buttonX + UNO_BUTTON_SIZE &&
           y >= buttonY && y <= buttonY + UNO_BUTTON_SIZE;
}

/**
 * Check if return to lobby button was clicked
 */
function checkReturnToLobbyButtonClick(x, y) {
    const { width, height } = getCanvasContext();
    const gameState = getCurrentGameState();
    
    // Only check if game is finished
    // Note: winner can be 0 (player index 0), so check for null/undefined instead of truthy
    if (!gameState || gameState.status !== 'finished' || gameState.winner == null) {
        // Button check failed - game not finished
        return false;
    }
    
    // Calculate button position (same as in renderer - inside the box)
    const scaleFactor = Math.min(width / 1200, 1.2);
    const baseWidth = 400;
    const baseHeight = 200;
    const boxWidth = baseWidth * scaleFactor;
    const boxHeight = baseHeight * scaleFactor;
    const boxX = width / 2 - boxWidth / 2;
    const boxY = height / 2 - boxHeight / 2;
    
    // Button size and position (inside the box)
    const buttonWidth = boxWidth * 0.7; // 70% of box width
    const buttonHeight = boxHeight * 0.25; // 25% of box height
    const buttonX = boxX + (boxWidth - buttonWidth) / 2; // Centered horizontally in box
    const buttonY = boxY + boxHeight * 0.6; // Position in lower portion of box
    
    // Button position check
    
    const clicked = x >= buttonX && x <= buttonX + buttonWidth &&
                    y >= buttonY && y <= buttonY + buttonHeight;
    
    return clicked;
}

/**
 * Check if a card in player's hand was clicked
 * @returns {number|null} Card index if clicked, null otherwise
 */
function checkPlayerCardClick(x, y) {
    if (!gameState || !gameState.players[localPlayerIndex]) {
        return null;
    }
    
    const { width, height } = getCanvasContext();
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    const player = gameState.players[localPlayerIndex];
    const handSize = player.hand.length;
    
    if (handSize === 0) return null;
    
    const cardSpacing = getCardSpacing(handSize);
    
    // Calculate card positions (same as renderer)
    const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    const startX = (width - totalWidth) / 2;
    const handY = height - 20 - cardHeight; // HAND_OFFSET_Y = 20
    
    // Check each card (check from right to left since cards overlap)
    // Cards overlap, so we need to check the rightmost card first
    for (let i = handSize - 1; i >= 0; i--) {
        const cardX = startX + (i * (cardWidth + cardSpacing));
        
        // Account for negative spacing (overlapping cards)
        // Each card's visible hitbox is its full width, but we need to account for overlap
        const cardLeft = cardX;
        const cardRight = cardX + cardWidth;
        const cardTop = handY;
        const cardBottom = handY + cardHeight;
        
        // Check if click is within this card's bounds
        if (x >= cardLeft && x <= cardRight && y >= cardTop && y <= cardBottom) {
            // For overlapping cards, check if we're in the non-overlapping portion
            // Cards overlap by cardSpacing (negative), so each card's unique hitbox is:
            // Left edge to (right edge - overlap amount)
            const overlapAmount = Math.abs(cardSpacing);
            const uniqueRight = i === handSize - 1 ? cardRight : cardRight - overlapAmount;
            
            // If click is in the unique portion of this card, or it's the rightmost card
            if (x <= uniqueRight || i === handSize - 1) {
                return i;
            }
        }
    }
    
    return null;
}

/**
 * Handle card click
 */
function handleCardClick(cardIndex) {
    const player = gameState.players[localPlayerIndex];
    const card = player.hand[cardIndex];
    
    if (!card) return;
    
    // Check if card can be played (pass player hand for Wild Draw 4 validation)
    const canPlay = canPlayCard(card, gameState.topCard, gameState.currentColor, player.hand);
    
    if (!canPlay) {
        // Provide specific error messages
        if (card.color === 'wild' && card.value === 'draw4') {
            // Cannot play Wild Draw 4: You have a card matching the current color
        } else {
            // Cannot play this card
        }
        return;
    }
    
    // If it's a wild card, show color picker
    if (card.color === 'wild') {
        showColorPickerForCard(cardIndex);
    } else {
        // Play the card directly
        const result = playCardFromHand(cardIndex);
        if (result.success) {
            updateGameState();
        }
    }
}

/**
 * Check if player has any playable cards in hand
 * @param {Array} playerHand - Player's hand
 * @param {Object} topCard - Top card on discard pile
 * @param {string} currentColor - Current color in play
 * @returns {boolean} True if player has at least one playable card
 */
export function hasPlayableCard(playerHand, topCard, currentColor) {
    if (!playerHand || playerHand.length === 0) {
        return false;
    }
    
    return playerHand.some(card => 
        canPlayCard(card, topCard, currentColor, playerHand)
    );
}

/**
 * Check if a card can be played
 * @param {Object} card - Card to check
 * @param {Object} topCard - Top card on discard pile
 * @param {string} currentColor - Current color in play
 * @param {Array} playerHand - Player's hand (optional, required for Wild Draw 4 validation)
 * @returns {boolean} True if card can be played
 */
function canPlayCard(card, topCard, currentColor, playerHand = null) {
    // Official UNO rules: Stacking is not allowed - you cannot play a Draw 2/4 to avoid drawing cards yourself.
    // However, if it's your turn again (after opponent drew and skipped), you CAN play draw cards.
    // Since the server immediately makes the next player draw, there's no "pending penalty" state.
    // The validation here only checks if the card matches by color or value.
    
    // Special validation for Wild Draw 4
    if (card.color === 'wild' && card.value === 'draw4') {
        // Wild Draw 4 can only be played if player has no card matching the current color
        // They can have: matching numbers, matching action cards, ANY wild cards
        // Only color matters
        if (playerHand && playerHand.length > 0) {
            // Check if player has any card matching the current color (excluding wild cards)
            const hasMatchingColor = playerHand.some(handCard => 
                handCard.color === currentColor && handCard.color !== 'wild'
            );
            
            if (hasMatchingColor) {
                return false; // Cannot play Wild Draw 4 if player has matching color card
            }
        }
        return true; // Can play Wild Draw 4 if no matching color cards
    }
    
    // Can always play regular wild cards
    if (card.color === 'wild') {
        return true;
    }
    
    // Match color
    if (card.color === currentColor) {
        return true;
    }
    
    // Match value
    if (card.value === topCard.value && card.color !== 'wild') {
        return true;
    }
    
    return false;
}

/**
 * Show color picker for wild card
 */
function showColorPickerForCard(cardIndex) {
    const { width, height } = getCanvasContext();
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Position color picker near the center
    colorPickerPosition = {
        x: centerX,
        y: centerY
    };
    
    pendingCardIndex = cardIndex;
    showColorPicker = true;
    
    // Re-render to show color picker
    // This will be handled by the renderer
}

/**
 * Hide color picker
 */
export function hideColorPicker() {
    showColorPicker = false;
    pendingCardIndex = null;
}

/**
 * Check if color picker was clicked
 * @returns {string|null} Selected color or null
 */
function checkColorPickerClick(x, y) {
    const pickerSize = 50;
    const spacing = 10;
    const colors = ['red', 'green', 'blue', 'yellow'];
    
    // Color picker is a 2x2 grid
    const startX = colorPickerPosition.x - (pickerSize + spacing);
    const startY = colorPickerPosition.y - (pickerSize + spacing);
    
    for (let i = 0; i < colors.length; i++) {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const colorX = startX + col * (pickerSize + spacing);
        const colorY = startY + row * (pickerSize + spacing);
        
        if (x >= colorX && x <= colorX + pickerSize &&
            y >= colorY && y <= colorY + pickerSize) {
            return colors[i];
        }
    }
    
    return null;
}

/**
 * Check if mouse is hovering over a color in the color picker
 * @returns {number|null} Color index if hovering, null otherwise
 */
function checkColorPickerHover(x, y) {
    if (!showColorPicker) {
        return null;
    }
    
    const pickerSize = 50;
    const spacing = 10;
    const colors = ['red', 'green', 'blue', 'yellow'];
    
    // Color picker is a 2x2 grid
    const startX = colorPickerPosition.x - (pickerSize + spacing);
    const startY = colorPickerPosition.y - (pickerSize + spacing);
    
    for (let i = 0; i < colors.length; i++) {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const colorX = startX + col * (pickerSize + spacing);
        const colorY = startY + row * (pickerSize + spacing);
        
        // Check if mouse is within circle bounds (using distance from center)
        const centerX = colorX + pickerSize / 2;
        const centerY = colorY + pickerSize / 2;
        const radius = pickerSize / 2;
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        
        if (distance <= radius) {
            return i;
        }
    }
    
    return null;
}

/**
 * Get hovered color index (for renderer)
 */
export function getHoveredColorIndex() {
    return hoveredColorIndex;
}

/**
 * Get color picker state (for renderer)
 */
export function getColorPickerState() {
    return {
        visible: showColorPicker,
        position: colorPickerPosition
    };
}

