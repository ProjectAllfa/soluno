/**
 * Generic Card Animation System
 * Handles all card animations: movement and flipping/revealing
 */

import { drawCard, getCardDimensions } from './cards.js';
import { getCanvasContext, getCardScale, getCardSpacing } from './canvas.js';

// Animation constants
// CARD_SCALE is now calculated dynamically via getCardScale() based on canvas size
export const ANIMATION_DURATION = 600; // milliseconds for movement
const FLIP_DURATION = 400; // milliseconds for flip
const SPECIAL_CARD_ANIMATION_DURATION = 1000; // milliseconds for skip/reverse animations
const EASING_FUNCTION = easeInOutCubic; // Smooth easing

// Active animations
let activeAnimations = [];

/**
 * Easing function for smooth animation
 */
function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Generic card movement animation
 * @param {Object} card - Card object to animate
 * @param {number} fromX - Starting X position
 * @param {number} fromY - Starting Y position
 * @param {number} toX - Target X position
 * @param {number} toY - Target Y position
 * @param {Object} options - Animation options
 * @param {boolean} options.reveal - If true, show card face during movement (default: false)
 * @param {number} options.duration - Animation duration in ms (default: ANIMATION_DURATION)
 * @param {Function} options.onComplete - Callback when animation completes
 * @returns {Object} Animation object
 */
export function animateCardMove(card, fromX, fromY, toX, toY, options = {}) {
    const {
        reveal = false,
        duration = ANIMATION_DURATION,
        onComplete = null,
        onUpdate = null,
        rotation = 0,
        fromRotation = null,
        toRotation = null
    } = options;
    
    // If fromRotation/toRotation are provided, animate rotation; otherwise use static rotation
    const animateRotation = fromRotation !== null && toRotation !== null;
    const startRotation = animateRotation ? fromRotation : rotation;
    const endRotation = animateRotation ? toRotation : rotation;
    
    const animation = {
        type: 'move',
        card: card,
        startTime: Date.now(),
        duration: duration,
        fromX: fromX,
        fromY: fromY,
        toX: toX,
        toY: toY,
        currentX: fromX,
        currentY: fromY,
        scale: getCardScale(),
        reveal: reveal,
        rotation: startRotation,
        fromRotation: animateRotation ? fromRotation : rotation,
        toRotation: animateRotation ? toRotation : rotation,
        animateRotation: animateRotation,
        onComplete: onComplete,
        onUpdate: onUpdate
    };
    
    activeAnimations.push(animation);
    return animation;
}

/**
 * Generic card flip/reveal animation (flips card in place)
 * @param {Object} card - Card object to animate
 * @param {number} x - X position of card
 * @param {number} y - Y position of card
 * @param {Object} options - Animation options
 * @param {number} options.duration - Animation duration in ms (default: FLIP_DURATION)
 * @param {Function} options.onComplete - Callback when animation completes
 * @returns {Object} Animation object
 */
export function animateCardFlip(card, x, y, options = {}) {
    const {
        duration = FLIP_DURATION,
        onComplete = null,
        rotation = 0
    } = options;
    
    const animation = {
        type: 'flip',
        card: card,
        startTime: Date.now(),
        duration: duration,
        x: x,
        y: y,
        scale: getCardScale(),
        flipProgress: 0, // 0 = face down, 1 = face up
        rotation: rotation,
        onComplete: onComplete
    };
    
    activeAnimations.push(animation);
    return animation;
}

/**
 * Update all active animations
 * Should be called every frame
 */
export function updateAnimations() {
    const now = Date.now();
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    for (let i = activeAnimations.length - 1; i >= 0; i--) {
        const anim = activeAnimations[i];
        const elapsed = now - anim.startTime;
        const progress = Math.min(elapsed / anim.duration, 1);
        const eased = EASING_FUNCTION(progress);
        
        if (anim.type === 'move') {
            // Update position
            anim.currentX = anim.fromX + (anim.toX - anim.fromX) * eased;
            anim.currentY = anim.fromY + (anim.toY - anim.fromY) * eased;
            
            // Update rotation if animating
            if (anim.animateRotation) {
                anim.rotation = anim.fromRotation + (anim.toRotation - anim.fromRotation) * eased;
            }
            
            // Slight scale up during animation
            anim.scale = cardScale * (1 + 0.1 * Math.sin(progress * Math.PI));
            
            // Call onUpdate callback if provided
            if (anim.onUpdate) {
                anim.onUpdate(progress, eased);
            }
        } else if (anim.type === 'flip') {
            // Update flip progress (0 = face down, 1 = face up)
            anim.flipProgress = eased;
            
            // If there's a concurrent move animation for the same card, follow its position and rotation
            const moveAnim = activeAnimations.find(a => 
                a.type === 'move' && 
                a.card === anim.card &&
                a !== anim
            );
            if (moveAnim) {
                // Update flip position to follow the moving card
                anim.x = moveAnim.currentX;
                anim.y = moveAnim.currentY;
                // Update flip rotation to follow the moving card's rotation
                anim.rotation = moveAnim.rotation;
            }
        } else if (anim.type === 'skip' || anim.type === 'reverse' || anim.type === 'color') {
            // Update progress for special card animations
            anim.progress = eased;
        }
        
        // Remove completed animations
        if (progress >= 1) {
            if (anim.onComplete) {
                anim.onComplete(anim);
            }
            activeAnimations.splice(i, 1);
        }
    }
}

/**
 * Render all active animations
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 */
export function renderAnimations(ctx) {
    const cardDims = getCardDimensions();
    
    // Render animations in two passes:
    // 1. First pass: all non-special animations (move, flip) - these are the card movements
    // 2. Second pass: special animations (skip, reverse, color) - these should appear on top
    // This ensures special animations like color change appear above card draw animations
    
    // First pass: render non-special animations
    activeAnimations.forEach(anim => {
        // Skip special animations in first pass
        if (anim.type === 'skip' || anim.type === 'reverse' || anim.type === 'color') {
            return;
        }
        const cardWidth = cardDims.width * anim.scale;
        const cardHeight = cardDims.height * anim.scale;
        
        ctx.save();
        
        if (anim.type === 'flip') {
            // Flip animation: show card back or face based on flip progress
            let cardColor = 'wild';
            let cardValue = 'back';
            
            // Show card face if flipped past halfway
            if (anim.flipProgress > 0.5) {
                cardColor = anim.card.color;
                cardValue = anim.card.value;
            }
            
            // Apply rotation if needed (for left/right opponents)
            const centerX = anim.x + cardWidth / 2;
            const centerY = anim.y + cardHeight / 2;
            ctx.translate(centerX, centerY);
            if (anim.rotation !== 0) {
                ctx.rotate(anim.rotation);
            }
            
            // Apply 3D flip effect using scale on X axis
            const flipScale = Math.abs(Math.cos(anim.flipProgress * Math.PI));
            ctx.scale(flipScale, 1);
            drawCard(ctx, cardColor, cardValue, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
        } else if (anim.type === 'move') {
            // Check if there's a concurrent flip animation for this card
            // If so, skip rendering the move (flip will handle it)
            const hasFlip = activeAnimations.some(a => 
                a.type === 'flip' && 
                a.card === anim.card &&
                a !== anim
            );
            
            if (!hasFlip) {
                // Move animation (only render if no flip is happening)
                let cardColor = 'wild';
                let cardValue = 'back';
                
                // Show card face if reveal is true
                if (anim.reveal) {
                    cardColor = anim.card.color;
                    cardValue = anim.card.value;
                }
                
                // Apply rotation if needed (for left/right opponents)
                if (anim.rotation !== 0) {
                    const centerX = anim.currentX + cardWidth / 2;
                    const centerY = anim.currentY + cardHeight / 2;
                    ctx.translate(centerX, centerY);
                    ctx.rotate(anim.rotation);
                    drawCard(ctx, cardColor, cardValue, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
                } else {
                    drawCard(ctx, cardColor, cardValue, anim.currentX, anim.currentY, cardWidth, cardHeight);
                }
            }
        } else if (anim.type === 'skip' || anim.type === 'reverse' || anim.type === 'color') {
            // Special card animation (skip, reverse, or color change)
            const { width, height } = getCanvasContext();
            const centerX = width / 2;
            const centerY = height / 2;
            
            ctx.save();
            ctx.translate(centerX, centerY);
            
            if (anim.type === 'reverse') {
                // Reverse: spin clockwise slowly, pause longer, then spin counter-clockwise slowly
                const spinProgress = anim.progress;
                let rotation = 0;
                if (spinProgress < 0.3) {
                    // First 30%: slow clockwise (0 to 360 degrees)
                    rotation = (spinProgress / 0.3) * Math.PI * 2; // 0 to 2*PI (full rotation)
                } else if (spinProgress < 0.55) {
                    // 30-55%: longer pause (stay at full rotation)
                    rotation = Math.PI * 2; // Full rotation, no change
                } else {
                    // Last 45%: slow counter-clockwise (360 to 0 degrees)
                    const counterProgress = (spinProgress - 0.55) / 0.45; // 0 to 1
                    rotation = (1 - counterProgress) * Math.PI * 2; // 2*PI to 0
                }
                ctx.rotate(rotation);
            } else if (anim.type === 'skip' || anim.type === 'color') {
                // Skip/Color: zoom in then fade out
                const zoomProgress = anim.progress;
                let scale = 0.3; // Start small
                if (zoomProgress < 0.6) {
                    // First 60%: zoom in from 0.3 to 1.0
                    scale = 0.3 + (zoomProgress / 0.6) * 0.7;
                } else {
                    // Last 40%: stay at 1.0 but fade out
                    scale = 1.0;
                }
                ctx.scale(scale, scale);
                
                // Fade out in last 40%
                if (zoomProgress > 0.6) {
                    const fadeProgress = (zoomProgress - 0.6) / 0.4;
                    ctx.globalAlpha = 1 - fadeProgress;
                }
            }
            
            // Draw the image (size based on card scale for responsiveness)
            const imageSize = cardDims.width * getCardScale() * 2.8; // Much larger than cards for visibility
            if (anim.image && anim.image.complete) {
                ctx.drawImage(anim.image, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
            }
            
            // Reset globalAlpha if it was modified
            if (anim.type === 'skip' || anim.type === 'color') {
                ctx.globalAlpha = 1.0;
            }
            
            ctx.restore();
        }
        
        ctx.restore();
    });
    
    // Second pass: render special animations (skip, reverse, color) on top
    activeAnimations.forEach(anim => {
        // Only render special animations in second pass
        if (anim.type !== 'skip' && anim.type !== 'reverse' && anim.type !== 'color') {
            return;
        }
        
        const cardWidth = cardDims.width * anim.scale;
        const cardHeight = cardDims.height * anim.scale;
        
        ctx.save();
        
        // Special card animation (skip, reverse, or color change)
        const { width, height } = getCanvasContext();
        const centerX = width / 2;
        const centerY = height / 2;
        
        ctx.save();
        ctx.translate(centerX, centerY);
        
        if (anim.type === 'reverse') {
            // Reverse: spin clockwise slowly, pause longer, then spin counter-clockwise slowly
            const spinProgress = anim.progress;
            let rotation = 0;
            if (spinProgress < 0.3) {
                // First 30%: slow clockwise (0 to 360 degrees)
                rotation = (spinProgress / 0.3) * Math.PI * 2; // 0 to 2*PI (full rotation)
            } else if (spinProgress < 0.55) {
                // 30-55%: longer pause (stay at full rotation)
                rotation = Math.PI * 2; // Full rotation, no change
            } else {
                // Last 45%: slow counter-clockwise (360 to 0 degrees)
                const counterProgress = (spinProgress - 0.55) / 0.45; // 0 to 1
                rotation = (1 - counterProgress) * Math.PI * 2; // 2*PI to 0
            }
            ctx.rotate(rotation);
        } else if (anim.type === 'skip' || anim.type === 'color') {
            // Skip/Color: zoom in then fade out
            const zoomProgress = anim.progress;
            let scale = 0.3; // Start small
            if (zoomProgress < 0.6) {
                // First 60%: zoom in from 0.3 to 1.0
                scale = 0.3 + (zoomProgress / 0.6) * 0.7;
            } else {
                // Last 40%: stay at 1.0 but fade out
                scale = 1.0;
            }
            ctx.scale(scale, scale);
            
            // Fade out in last 40%
            if (zoomProgress > 0.6) {
                const fadeProgress = (zoomProgress - 0.6) / 0.4;
                ctx.globalAlpha = 1 - fadeProgress;
            }
        }
        
        // Draw the image (size based on card scale for responsiveness)
        const imageSize = cardDims.width * getCardScale() * 2.8; // Much larger than cards for visibility
        if (anim.image && anim.image.complete) {
            ctx.drawImage(anim.image, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
        }
        
        // Reset globalAlpha if it was modified
        if (anim.type === 'skip' || anim.type === 'color') {
            ctx.globalAlpha = 1.0;
        }
        
        ctx.restore();
        ctx.restore();
    });
}

/**
 * Check if any animations are active
 */
export function hasActiveAnimations() {
    return activeAnimations.length > 0;
}

/**
 * Check if a specific card is currently being animated
 * @param {Object} card - Card object to check
 * @returns {boolean} True if card is being animated
 */
export function isCardAnimating(card) {
    return activeAnimations.some(anim => anim.card === card);
}

/**
 * Check if a specific card is currently being flipped
 * @param {Object} card - Card object to check
 * @returns {boolean} True if card is being flipped
 */
export function isCardFlipping(card) {
    return activeAnimations.some(anim => 
        anim.type === 'flip' && 
        anim.card === card
    );
}

/**
 * Check if a specific card is currently being moved
 * @param {Object} card - Card object to check
 * @returns {boolean} True if card is being moved
 */
export function isCardMoving(card) {
    return activeAnimations.some(anim => 
        anim.type === 'move' && 
        anim.card === card
    );
}

/**
 * Clear all animations
 */
export function clearAnimations() {
    activeAnimations = [];
}

// ============================================================================
// Convenience functions for common use cases (backward compatibility)
// ============================================================================

/**
 * Animate card draw (move from deck to hand, then optionally flip)
 * @param {Object} card - Card object
 * @param {number} fromX - Starting X
 * @param {number} fromY - Starting Y
 * @param {number} toX - Target X
 * @param {number} toY - Target Y
 * @param {boolean} flipAfter - If true, flip card after movement
 * @returns {Object} Animation object
 */
export function animateCardDraw(card, fromX, fromY, toX, toY, flipAfter = false) {
    const moveAnim = animateCardMove(card, fromX, fromY, toX, toY, {
        reveal: false,
        onComplete: flipAfter ? () => {
            animateCardFlip(card, toX, toY);
        } : null
    });
    return moveAnim;
}

/**
 * Animate card play (move from hand to discard pile with reveal)
 * @param {Object} card - Card object
 * @param {number} fromX - Starting X
 * @param {number} fromY - Starting Y
 * @param {number} toX - Target X
 * @param {number} toY - Target Y
 * @returns {Object} Animation object
 */
export function animateCardPlay(card, fromX, fromY, toX, toY, options = {}) {
    return animateCardMove(card, fromX, fromY, toX, toY, {
        reveal: true,
        ...options
    });
}

// Legacy function name (for backward compatibility)
export function isCardDrawing(card) {
    return isCardMoving(card);
}

/**
 * Animate skip card effect (zoom in then fade out)
 * @param {Image} image - Skip animation image
 * @param {Function} onComplete - Callback when animation completes
 */
export function animateSkipCard(image, onComplete = null) {
    const animation = {
        type: 'skip',
        image: image,
        startTime: Date.now(),
        duration: SPECIAL_CARD_ANIMATION_DURATION,
        progress: 0,
        onComplete: onComplete
    };
    
    activeAnimations.push(animation);
    return animation;
}

/**
 * Animate reverse card effect (spin clockwise then counter-clockwise)
 * @param {Image} image - Reverse animation image
 * @param {Function} onComplete - Callback when animation completes
 */
export function animateReverseCard(image, onComplete = null) {
    const animation = {
        type: 'reverse',
        image: image,
        startTime: Date.now(),
        duration: SPECIAL_CARD_ANIMATION_DURATION,
        progress: 0,
        onComplete: onComplete
    };
    
    activeAnimations.push(animation);
    return animation;
}

/**
 * Animate color change effect (zoom in then fade out)
 * @param {Image} image - Color image (red, green, blue, or yellow)
 * @param {Function} onComplete - Callback when animation completes
 */
export function animateColorChange(image, onComplete = null) {
    const animation = {
        type: 'color',
        image: image,
        startTime: Date.now(),
        duration: SPECIAL_CARD_ANIMATION_DURATION,
        progress: 0,
        onComplete: onComplete
    };
    
    activeAnimations.push(animation);
    return animation;
}

// ============================================================================
// Deal animation system (uses generic animation functions)
// ============================================================================

let isDealing = false;
let dealQueue = [];
let dealLocalPlayerIndex = 0;
let dealPlayers = null;

/**
 * Start dealing cards animation
 * @param {Array} players - Array of player objects
 * @param {Array} deck - The deck to deal from
 * @param {number} cardsPerPlayer - Number of cards to deal to each player
 * @param {number} localPlayerIndex - Index of local player
 * @param {Function} onCardDealt - Callback when each card is dealt (playerIndex, card)
 * @param {Function} onDealComplete - Callback when dealing is complete
 */
export function startDealAnimation(players, deck, cardsPerPlayer, localPlayerIndex, onCardDealt, onDealComplete) {
    dealLocalPlayerIndex = localPlayerIndex;
    dealPlayers = players;
    isDealing = true;
    dealQueue = [];
    
    const { width, height } = getCanvasContext();
    const deckPos = getDrawDeckPosition(width, height);
    
    // Create deal queue: deal one card to each player in rotation
    for (let cardIndex = 0; cardIndex < cardsPerPlayer; cardIndex++) {
        for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
            const deckIndex = cardIndex * players.length + playerIndex;
            const card = deck[deckIndex];
            if (!card) continue;
            
            dealQueue.push({
                card: card,
                playerIndex: playerIndex,
                cardIndex: cardIndex,
                delay: (cardIndex * players.length + playerIndex) * 250 // Stagger animations
            });
        }
    }
    
    // Process deal queue
    processDealQueue(onCardDealt, onDealComplete);
}

/**
 * Calculate target position for a card based on current hand state
 */
function calculateTargetPosition(playerIndex, cardIndex, width, height) {
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    // Calculate position based on current hand size (card is already added)
    // This matches exactly what the renderer will calculate
    if (!dealPlayers || !dealPlayers[playerIndex]) {
        return { x: 0, y: 0, rotation: 0 };
    }
    
    const currentHandSize = dealPlayers[playerIndex].hand.length;
    const cardSpacing = getCardSpacing(currentHandSize);
    // cardIndex is the index this card has in the hand (which matches where it was added)
    // Calculate position using currentHandSize to match renderer exactly
    
    if (playerIndex === dealLocalPlayerIndex) {
        // Local player (bottom) - calculate exactly like renderer does
        // Renderer uses: totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing)
        //                startX = (canvasWidth - totalWidth) / 2
        //                cardX = startX + (index * (cardWidth + cardSpacing))
        const totalWidth = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
        const startX = (width - totalWidth) / 2;
        const handY = height - 20 - cardHeight; // HAND_OFFSET_Y = 20
        return {
            x: startX + (cardIndex * (cardWidth + cardSpacing)),
            y: handY,
            rotation: 0
        };
    } else {
        // Opponent players - calculate exactly like renderer does
        const playerCount = dealPlayers ? dealPlayers.length : 2;
        const relativeIndex = playerIndex < dealLocalPlayerIndex ? playerIndex : playerIndex - 1;
        
        if (playerCount === 2) {
            // Only one opponent (top)
            const totalWidth = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
            const startX = (width - totalWidth) / 2;
            return {
                x: startX + (cardIndex * (cardWidth + cardSpacing)),
                y: 20, // OPPONENT_OFFSET_Y
                rotation: 0
            };
        } else if (playerCount === 3) {
            if (relativeIndex === 0) {
                // Top opponent
                const totalWidth = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
                const startX = (width - totalWidth) / 2;
                return {
                    x: startX + (cardIndex * (cardWidth + cardSpacing)),
                    y: 20,
                    rotation: 0
                };
            } else {
                // Left opponent (vertical) - calculate exactly like renderOpponentHandVertical
                // Left side: rotate 90 degrees clockwise (Math.PI / 2) so top faces center
                const totalHeight = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
                const centerY = height / 2;
                const startY = centerY - totalHeight / 2;
                const cardY = startY + (cardIndex * (cardWidth + cardSpacing));
                return {
                    x: 50, // VERTICAL_CARD_EDGE_SPACING
                    y: cardY,
                    rotation: Math.PI / 2 // Left side: clockwise rotation
                };
            }
        } else if (playerCount === 4) {
            if (relativeIndex === 0) {
                // Top opponent
                const totalWidth = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
                const startX = (width - totalWidth) / 2;
                return {
                    x: startX + (cardIndex * (cardWidth + cardSpacing)),
                    y: 20,
                    rotation: 0
                };
            } else if (relativeIndex === 1) {
                // Right opponent (vertical) - calculate exactly like renderOpponentHandVertical
                // Right side: rotate 90 degrees counter-clockwise (-Math.PI / 2) so top faces center
                const totalHeight = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
                const centerY = height / 2;
                const startY = centerY - totalHeight / 2;
                const cardY = startY + (cardIndex * (cardWidth + cardSpacing));
                return {
                    x: width - 50 - cardWidth, // width - VERTICAL_CARD_EDGE_SPACING - cardWidth
                    y: cardY,
                    rotation: -Math.PI / 2 // Right side: counter-clockwise rotation
                };
            } else {
                // Left opponent (vertical) - calculate exactly like renderOpponentHandVertical
                // Left side: rotate 90 degrees clockwise (Math.PI / 2) so top faces center
                const totalHeight = (currentHandSize * cardWidth) + ((currentHandSize - 1) * cardSpacing);
                const centerY = height / 2;
                const startY = centerY - totalHeight / 2;
                const cardY = startY + (cardIndex * (cardWidth + cardSpacing));
                return {
                    x: 50, // VERTICAL_CARD_EDGE_SPACING
                    y: cardY,
                    rotation: Math.PI / 2 // Left side: clockwise rotation
                };
            }
        }
    }
    
    return { x: 0, y: 0, rotation: 0 };
}

/**
 * Process the deal queue - start all animations with absolute timing
 */
function processDealQueue(onCardDealt, onDealComplete) {
    if (dealQueue.length === 0) {
        isDealing = false;
        if (onDealComplete) {
            onDealComplete();
        }
        return;
    }
    
    const { width, height } = getCanvasContext();
    const deckPos = getDrawDeckPosition(width, height);
    
    // Start all animations with their absolute delays from start time
    dealQueue.forEach((dealItem) => {
        setTimeout(() => {
            // Determine if this is for local player
            const isLocalPlayer = dealItem.playerIndex === dealLocalPlayerIndex;
            
            // Get hand size BEFORE adding the card (for position calculation)
            const handSizeBefore = dealPlayers && dealPlayers[dealItem.playerIndex] 
                ? dealPlayers[dealItem.playerIndex].hand.length 
                : 0;
            
            // For local player, add card to hand FIRST so hand layout is correct for position calculation
            // For remote players, we'll add it after animation completes to avoid showing it prematurely
            if (isLocalPlayer && onCardDealt) {
                onCardDealt(dealItem.playerIndex, dealItem.card);
            }
            
            // Calculate target position
            // For local player: card is already added, so calculateTargetPosition uses current hand size
            // For remote players: we need to temporarily add it to calculate position, then remove it
            let targetPos;
            if (isLocalPlayer) {
                // Card already added, calculate based on current hand size
                targetPos = calculateTargetPosition(dealItem.playerIndex, dealItem.cardIndex, width, height);
            } else {
                // For remote players, temporarily add card to calculate position
                if (dealPlayers && dealPlayers[dealItem.playerIndex]) {
                    dealPlayers[dealItem.playerIndex].hand.push(dealItem.card);
                    targetPos = calculateTargetPosition(dealItem.playerIndex, dealItem.cardIndex, width, height);
                    // Remove it immediately (we'll add it after animation completes)
                    dealPlayers[dealItem.playerIndex].hand.pop();
                } else {
                    targetPos = { x: 0, y: 0 };
                }
            }
            
            // Use generic move animation with rotation for left/right opponents
            animateCardMove(dealItem.card, deckPos.x, deckPos.y, targetPos.x, targetPos.y, {
                reveal: false,
                fromRotation: 0, // Start unrotated (from deck)
                toRotation: targetPos.rotation || 0, // End with target rotation (for left/right opponents)
                onComplete: () => {
                    // For remote players, add card to hand AFTER animation completes
                    if (!isLocalPlayer && onCardDealt) {
                        onCardDealt(dealItem.playerIndex, dealItem.card);
                    }
                    
                    // For local player, trigger flip animation after movement
                    if (isLocalPlayer) {
                        animateCardFlip(dealItem.card, targetPos.x, targetPos.y, {
                            rotation: targetPos.rotation || 0
                        });
                    }
                }
            });
        }, dealItem.delay);
    });
    
    // Calculate when the last card will finish animating
    const maxDelay = Math.max(...dealQueue.map(item => item.delay));
    const totalTime = maxDelay + ANIMATION_DURATION + (dealLocalPlayerIndex !== -1 ? FLIP_DURATION : 0);
    
    // Call completion callback after all animations finish
    setTimeout(() => {
        isDealing = false;
        if (onDealComplete) {
            onDealComplete();
        }
    }, totalTime);
    
    // Clear the queue since we've scheduled all animations
    dealQueue = [];
}

/**
 * Check if cards are being dealt
 */
export function isDealingCards() {
    return isDealing || dealQueue.length > 0;
}

/**
 * Get card position in player's hand
 * @param {number} cardIndex - Index of card in hand
 * @param {number} handSize - Total number of cards in hand
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Object} { x, y } position
 */
export function getCardHandPosition(cardIndex, handSize, canvasWidth, canvasHeight) {
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    const cardSpacing = getCardSpacing(handSize);
    
    const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
    const startX = (canvasWidth - totalWidth) / 2;
    const handY = canvasHeight - 20 - cardHeight; // HAND_OFFSET_Y = 20
    
    return {
        x: startX + (cardIndex * (cardWidth + cardSpacing)),
        y: handY
    };
}

/**
 * Get draw deck position
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Object} { x, y } position
 */
export function getDrawDeckPosition(canvasWidth, canvasHeight) {
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const totalWidth = (cardWidth * 2);
    const drawDeckX = centerX - totalWidth / 2;
    const deckY = centerY - cardHeight / 2;
    
    return {
        x: drawDeckX,
        y: deckY
    };
}

/**
 * Get discard pile position
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @returns {Object} { x, y } position
 */
export function getDiscardPilePosition(canvasWidth, canvasHeight) {
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const totalWidth = (cardWidth * 2);
    const discardPileX = centerX + totalWidth / 2 - cardWidth;
    const discardY = centerY - cardHeight / 2;
    
    return {
        x: discardPileX,
        y: discardY
    };
}
