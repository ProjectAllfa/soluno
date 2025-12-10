/**
 * Game Manager
 * Orchestrates game logic, rendering, and input
 */

// All game logic is now server-authoritative (see server/gameLogic.js)
import { setGameState, render as renderGame, getAnimationImages, getColorImages, triggerUnoCallAnimation } from './renderer.js';
import { setGameRenderFunction, getCanvasContext, getCardScale, getCardSpacing } from './canvas.js';
import { initInput, updateGameState as updateInputState, hideColorPicker } from './input.js';
import { animateCardDraw, animateCardPlay, animateCardFlip, animateCardMove, getCardHandPosition, getDrawDeckPosition, getDiscardPilePosition, startDealAnimation, isDealingCards, ANIMATION_DURATION, animateSkipCard, animateReverseCard, animateColorChange } from './cardAnimation.js';
import { getCardDimensions } from './cards.js';
import { playCard as socketPlayCard, drawCard as socketDrawCard, callUno as socketCallUno, endTurn as socketEndTurn } from '../client/socketClient.js';

let currentGameState = null;
let localPlayerIndex = 0;
let isGameActive = false;
let previousGameState = null; // Track previous state to detect changes
let isReconnecting = false; // Track if we're in the middle of reconnecting
let pendingDrawAnimation = null; // Track pending draw animation to update card when server responds
let pendingDiscardPileCard = null; // Track first discard pile card animation
let pendingPlayAnimation = null; // Track card being played (to avoid adding to discard pile before animation completes)
let pendingOpponentPlayAnimation = null; // Track opponent card being played
let turnTimerInterval = null; // Client-side timer update interval
let turnExpiresAt = null; // Server timestamp when current turn expires
let turnTimerPlayerIndex = null; // Track which player's turn the timer is for
let serverTimeOffset = 0; // Clock offset between server and client (serverTime - clientTime)
let actionsBlocked = false; // Block actions while waiting for new turn (e.g., after action card in 2-player mode)
// Track card indices that are being animated (so we don't render them in hand until animation completes)
// Format: { playerIndex: Set<cardIndex> }
let animatedCardIndices = {};

// Legacy startGame() function removed - all games now start via startGameFromServer() (server-authoritative)

/**
 * Update game state (called from server or local actions)
 * @param {Object} state - New game state
 */
export function updateGameState(state) {
    currentGameState = state;
    setGameState(currentGameState, localPlayerIndex);
    updateInputState();
}

/**
 * Get current game state
 */
export function getCurrentGameState() {
    return currentGameState;
}

/**
 * Check if it's local player's turn
 */
export function isMyTurn() {
    if (!currentGameState || !isGameActive) return false;
    
    return currentGameState.currentPlayerIndex === localPlayerIndex;
}

/**
 * Check if player can play or draw cards (not waiting for UNO)
 */
export function canPlayOrDraw() {
    if (!isMyTurn()) return false;
    
    // If waiting for UNO, player can only call UNO (cannot play or draw)
    if (currentGameState && currentGameState.waitingForUno === true) {
        return false;
    }
    
    return true;
}

/**
 * Play a card from local player's hand
 * @param {number} cardIndex - Index of card in hand
 * @param {string} chosenColor - Color for wild card (optional)
 */
export function playCardFromHand(cardIndex, chosenColor = null) {
    if (!canPlayOrDraw()) {
        return { success: false, message: 'Cannot play - call UNO first' };
    }
    
    // Check if actions are blocked (waiting for new turn after action card in 2-player mode)
    if (actionsBlocked) {
        return { success: false, message: 'Please wait for your next turn' };
    }

    const player = currentGameState.players[localPlayerIndex];
    const card = player.hand[cardIndex];
    
    if (!card) {
        return { success: false, message: 'Invalid card' };
    }

    // Double-check waitingForUno right before optimistic update (race condition protection)
    if (currentGameState && currentGameState.waitingForUno === true) {
        return { success: false, message: 'Cannot play - call UNO first' };
    }

    // Get positions for animation (before removing card)
    const { width, height } = getCanvasContext();
    const handPos = getCardHandPosition(cardIndex, player.hand.length, width, height);
    const discardPos = getDiscardPilePosition(width, height);
    
    // Get card before removing (for animation)
    const playedCard = { ...card }; // Copy card object
    
    // Send action to server FIRST (before optimistic update)
    // Server needs the original cardIndex
    socketPlayCard(cardIndex, chosenColor);
    
    // Check if this is an action card in 2-player mode that gives the same player another turn
    // In 2-player mode: Skip, Reverse, Draw 2, and Draw 4 all give the same player another turn
    const isTwoPlayerMode = currentGameState && currentGameState.players.length === 2;
    const isActionCardGivingAnotherTurn = isTwoPlayerMode && (
        playedCard.value === 'skip' ||
        playedCard.value === 'reverse' ||
        playedCard.value === 'draw2' ||
        playedCard.value === 'draw4'
    );
    
    // Clear timer optimistically if:
    // 1. It's an action card in 2-player mode (same player gets another turn with fresh timer)
    // 2. OR if player doesn't need to call UNO (turn will end)
    // Don't clear if player needs to call UNO (turn continues, timer should keep running)
    const willNeedUno = player.hand.length === 2; // After playing, will have 1 card
    
    if (isActionCardGivingAnotherTurn || !willNeedUno) {
        // Clear timer optimistically - either same player gets fresh timer, or turn ends
        if (turnTimerInterval) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
        }
        turnExpiresAt = null;
        turnTimerPlayerIndex = null;
        if (currentGameState) {
            currentGameState.turnTimeRemaining = null;
            // Update state immediately so timer disappears from UI
            setGameState(currentGameState, localPlayerIndex);
        }
        
        // Block actions if this is an action card in 2-player mode
        // Actions will be unblocked when turn_start event arrives with new timer
        if (isActionCardGivingAnotherTurn) {
            actionsBlocked = true;
            // Actions blocked - waiting for new turn after action card
        }
    }
    // If willNeedUno is true and not an action card, timer will continue running (turn doesn't end yet)
    
    // Remove card from hand immediately (optimistic) so it doesn't render in hand
    player.hand.splice(cardIndex, 1);
    
    // Track pending play animation
    pendingPlayAnimation = {
        card: playedCard,
        discardPos: discardPos
    };
    
    // Update game state to reflect card removed from hand
    setGameState(currentGameState, localPlayerIndex);
    
    // Start play animation (optimistic update)
    animateCardPlay(playedCard, handPos.x, handPos.y, discardPos.x, discardPos.y, {
        onComplete: () => {
            // After animation completes, add card to discard pile
            if (pendingPlayAnimation && currentGameState) {
                currentGameState.topCard = pendingPlayAnimation.card;
                if (!currentGameState.discardPile) {
                    currentGameState.discardPile = [];
                }
                currentGameState.discardPile.push(pendingPlayAnimation.card);
                // Update current color from server (important for wild cards)
                let newColor = null;
                if (pendingPlayAnimation.currentColor !== undefined) {
                    newColor = pendingPlayAnimation.currentColor;
                    currentGameState.currentColor = newColor;
                } else if (pendingPlayAnimation.card.color !== 'wild') {
                    // Fallback to card color if server color not available
                    newColor = pendingPlayAnimation.card.color;
                    currentGameState.currentColor = newColor;
                }
                
                setGameState(currentGameState, localPlayerIndex);
                
                // Trigger special card animation if applicable
                const animImages = getAnimationImages();
                const colorImgs = getColorImages();
                if (animImages.loaded) {
                    if (playedCard.value === 'skip' && animImages.skip) {
                        animateSkipCard(animImages.skip);
                    } else if (playedCard.value === 'reverse' && animImages.reverse) {
                        animateReverseCard(animImages.reverse);
                    }
                }
                
                // Trigger color animation if wild card or draw 4 was played
                if (colorImgs.loaded && (playedCard.color === 'wild' || playedCard.value === 'draw4')) {
                    // Use the color we just set, or fallback to currentGameState.currentColor
                    const colorToUse = newColor || currentGameState.currentColor;
                    if (colorToUse && colorImgs[colorToUse]) {
                        // Triggering color animation
                        animateColorChange(colorImgs[colorToUse]);
                    } else {
                        // Color animation not triggered
                    }
                }
                
                pendingPlayAnimation = null;
            }
        }
    });
    
    return { success: true, message: 'Card playing...' };
}

/**
 * Draw a card for local player
 */
export function drawCardForPlayer() {
    if (!canPlayOrDraw()) {
        return { success: false, message: 'Cannot draw - call UNO first' };
    }
    
    // Check if actions are blocked (waiting for new turn after action card in 2-player mode)
    if (actionsBlocked) {
        return { success: false, message: 'Please wait for your next turn' };
    }

    const player = currentGameState.players[localPlayerIndex];
    if (!player) {
        return { success: false, message: 'Player not found' };
    }

    // Double-check waitingForUno right before optimistic update (race condition protection)
    if (currentGameState && currentGameState.waitingForUno === true) {
        return { success: false, message: 'Cannot draw - call UNO first' };
    }

    // Get positions for animation
    const { width, height } = getCanvasContext();
    const deckPos = getDrawDeckPosition(width, height);
    const currentHandSize = player.hand.length;
    const newHandSize = currentHandSize + 1;
    const handPos = getCardHandPosition(currentHandSize, newHandSize, width, height);
    
    // Create a placeholder card for animation (we'll update it with real card when server responds)
    const placeholderCard = { color: 'wild', value: 'back' };
    
    // Store animation info so we can update card when server responds
    pendingDrawAnimation = {
        card: placeholderCard,
        handPos: handPos
    };
    
    // Start draw animation immediately (optimistic)
    animateCardMove(placeholderCard, deckPos.x, deckPos.y, handPos.x, handPos.y, {
        reveal: false,
        onComplete: () => {
            // After card reaches hand, flip it to reveal (for local player)
            animateCardFlip(placeholderCard, handPos.x, handPos.y, {
                onComplete: () => {
                    // Clear pending animation after everything is done
                    // The card will now render in hand position from server state
                    pendingDrawAnimation = null;
                }
            });
        }
    });

    // Send action to server (server-authoritative)
    socketDrawCard();
    
    // Don't clear timer optimistically for draw - we don't know if card is playable yet
    // If card is playable, turn continues (hasDrawnPlayableCard = true), timer should keep running
    // If card is not playable, turn ends automatically, and turn change detection will clear timer
    // The server will send a state update that will handle timer clearing if turn ends
    
    return { success: true, message: 'Drawing card...' };
}

/**
 * End turn for local player (when they drew a playable card but choose not to play it)
 */
export function endTurnForPlayer() {
    if (!isMyTurn()) {
        return { success: false, message: 'Not your turn' };
    }

    // Send action to server (server-authoritative)
    socketEndTurn();
    
    // Clear timer immediately (optimistic) - player took action
    // This prevents old timer from showing while waiting for server response
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    turnExpiresAt = null;
    turnTimerPlayerIndex = null;
    if (currentGameState) {
        currentGameState.turnTimeRemaining = null;
        // Update state immediately so timer disappears from UI
        setGameState(currentGameState, localPlayerIndex);
    }
    
    return { success: true, message: 'Ending turn...' };
}

/**
 * Call UNO for local player
 */
export function callUnoForPlayer() {
    // Trigger animation immediately for local player (optimistic update)
    // This ensures the local player sees the UNO call image right away
    triggerUnoCallAnimation(localPlayerIndex);
    
    // Send action to server (server-authoritative)
    socketCallUno();
    
    // Clear timer immediately (optimistic) - player took action
    // This prevents old timer from showing while waiting for server response
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    turnExpiresAt = null;
    turnTimerPlayerIndex = null;
    if (currentGameState) {
        currentGameState.turnTimeRemaining = null;
        // Update state immediately so timer disappears from UI
        setGameState(currentGameState, localPlayerIndex);
    }
    
    return { success: true, message: 'UNO called' };
}

/**
 * Render the game (called from canvas render loop)
 */
export function render() {
    if (isGameActive && currentGameState) {
        renderGame();
    }
}

/**
 * Start game from server state (multiplayer)
 * @param {Object} serverState - Game state from server
 * @param {number} playerIndex - Index of local player
 * @param {boolean} isReconnection - If true, skip deal animation and set state directly
 */
export function startGameFromServer(serverState, playerIndex, isReconnection = false) {
    try {
        localPlayerIndex = playerIndex;
        isGameActive = true;
        
        if (isReconnection) {
            // For reconnection, skip animations and set state directly
            // Reconnecting to game, skipping animations
            isReconnecting = true;
            
            // Convert server state to client format directly
            const clientState = {
                players: serverState.players.map((p, idx) => ({
                    id: p.id,
                    // Server sends empty array for opponents, but includes handSize
                    hand: p.hand && p.hand.length > 0 ? p.hand : 
                          (p.handSize ? new Array(p.handSize).fill({ color: 'wild', value: 'back' }) : []),
                    handSize: p.handSize || (p.hand ? p.hand.length : 0),
                    name: p.name,
                    hasUno: p.hasUno || false
                })),
                deck: new Array(serverState.deck.count || 0).fill(null),
                discardPile: serverState.discardPile || [],
                topCard: serverState.topCard,
                currentPlayerIndex: serverState.currentPlayerIndex,
                direction: serverState.direction,
                status: serverState.status,
                winner: serverState.winner,
                currentColor: serverState.currentColor,
                waitingForUno: serverState.waitingForUno || false
            };
            
            currentGameState = clientState;
            previousGameState = null;
            
            // Update renderer with full state immediately
            setGameState(currentGameState, localPlayerIndex);
            
            // Register render function with canvas
            setGameRenderFunction(render);
            
            // Initialize input handling
            initInput(playerIndex);
            
            // Update input state
            updateInputState();
            
            // Mark reconnection as complete after a short delay
            // This prevents animations from triggering on the first state update
            setTimeout(() => {
                isReconnecting = false;
            }, 1000);
            
            // Game reconnected
            return currentGameState;
        }
        
        // Normal game start - use deal animation
        // Initialize with empty hands for deal animation
        // The animation will add cards one by one
        const initialClientState = {
            players: serverState.players.map((p, idx) => ({
                id: p.id,
                hand: [], // Start with empty hands for animation
                handSize: 0, // Start with 0 for comparison
                name: p.name,
                hasUno: p.hasUno || false
            })),
            deck: new Array(serverState.deck.count || 0).fill(null), // Just for count
            discardPile: [], // Start empty - will be set after animation
            topCard: null, // Start null - will be set after animation completes
            currentPlayerIndex: serverState.currentPlayerIndex,
            direction: serverState.direction,
            status: serverState.status,
            winner: serverState.winner,
            currentColor: null // Will be set after first discard pile card is drawn
        };
        
        currentGameState = initialClientState;
        previousGameState = null; // Reset previous state
        
        // Update renderer with initial empty state
        setGameState(currentGameState, localPlayerIndex);
        
        // Register render function with canvas
        setGameRenderFunction(render);
        
        // Initialize input handling
        initInput(playerIndex);
        
        // Start deal animation - it will add cards one by one
        startDealAnimationFromServer(serverState, playerIndex);
        
        // Game started from server
        return currentGameState;
    } catch (error) {
        console.error('Failed to start game from server:', error);
        return null;
    }
}

/**
 * Start deal animation from server state
 */
function startDealAnimationFromServer(serverState, playerIndex) {
    // Starting deal animation from server state
    
    const playerCount = serverState.players.length;
    const cardsPerPlayer = 7;
    
    // Get local player's hand (cards are already dealt by server)
    const localPlayer = serverState.players[playerIndex];
    const localHand = localPlayer.hand || [];
    
    // Local player hand loaded
    
    // Create players array with empty hands (we'll add cards during animation)
    const playersForAnimation = serverState.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        hand: [], // Start with empty hands
        hasUno: false
    }));
    
    // Create a "deck" with all the cards we need to deal
    // We'll use the actual cards from the local player's hand
    // For opponents, we'll use placeholder cards
    const deckForAnimation = [];
    
    // Add cards in deal order (one card per player, repeat)
    for (let cardIndex = 0; cardIndex < cardsPerPlayer; cardIndex++) {
        for (let playerIdx = 0; playerIdx < playerCount; playerIdx++) {
            if (playerIdx === playerIndex) {
                // Use actual card from local player's hand
                if (localHand[cardIndex]) {
                    deckForAnimation.push(localHand[cardIndex]);
                } else {
                    deckForAnimation.push({ color: 'wild', value: 'back' });
                }
            } else {
                // Placeholder for opponent cards (they'll be face down anyway)
                deckForAnimation.push({ color: 'wild', value: 'back' });
            }
        }
    }
    
    // Deck for animation prepared
    
    // Start deal animation
    startDealAnimation(
        playersForAnimation,
        deckForAnimation,
        cardsPerPlayer,
        playerIndex,
        // Callback when each card is dealt
        (playerIdx, card) => {
            // Add card to the player's hand in our animation state
            playersForAnimation[playerIdx].hand.push(card);
            
            // Update current game state to reflect the growing hands progressively
            currentGameState.players = playersForAnimation.map((p, idx) => {
                if (idx === playerIndex) {
                    // For local player, use actual cards
                    return {
                        ...p,
                        hand: p.hand
                    };
                } else {
                    // For opponents, use the progressively growing hand (one card at a time)
                    // Don't use handSize here - let it grow naturally during animation
                    return {
                        ...p,
                        hand: p.hand.map(() => ({ color: 'wild', value: 'back' })) // Convert to placeholder cards
                    };
                }
            });
            
            setGameState(currentGameState, localPlayerIndex);
        },
        // Callback when all cards are dealt
        () => {
            // Ensure all cards are in place with correct final state
            currentGameState.players[playerIndex].hand = localHand;
            
            // Ensure opponents have correct hand sizes (face down cards)
            serverState.players.forEach((p, idx) => {
                if (idx !== playerIndex && p.handSize) {
                    currentGameState.players[idx].hand = new Array(p.handSize).fill({ color: 'wild', value: 'back' });
                }
            });
            
            // Animate first discard pile card (draw from deck and flip)
            if (serverState.topCard) {
                // Don't add to game state yet - wait for animation to complete
                // Clear topCard and discardPile so it doesn't render during animation
                currentGameState.topCard = null;
                currentGameState.discardPile = [];
                
                // Store the card for animation
                pendingDiscardPileCard = serverState.topCard;
                
                const { width, height } = getCanvasContext();
                const deckPos = getDrawDeckPosition(width, height);
                const discardPos = getDiscardPilePosition(width, height);
                
                // Use generic animation: move from deck to discard pile, then flip
                animateCardMove(serverState.topCard, deckPos.x, deckPos.y, discardPos.x, discardPos.y, {
                    reveal: false,
                    onComplete: () => {
                        animateCardFlip(serverState.topCard, discardPos.x, discardPos.y, {
                            onComplete: () => {
                                // After flip completes, add to game state
                                currentGameState.topCard = serverState.topCard;
                                currentGameState.discardPile = [serverState.topCard];
                                currentGameState.currentColor = serverState.topCard.color;
                                currentGameState.status = serverState.status; // Set to 'playing'
                                pendingDiscardPileCard = null;
                                
                                setGameState(currentGameState, localPlayerIndex);
                                updateInputState();
                                // First discard pile card animated and set
                            }
                        });
                    }
                });
            } else {
                // No topCard, just update state
                currentGameState.status = serverState.status;
            }
            
            // Update state (without discard pile card if animation is pending)
            setGameState(currentGameState, localPlayerIndex);
            updateInputState();
            // Deal animation complete
        }
    );
}

/**
 * Update game state from server (called when server sends state update)
 * @param {Object} serverState - Game state from server
 */
export function updateGameStateFromServer(serverState) {
    if (!isGameActive) return;
    
    // Skip animations during reconnection
    if (isReconnecting) {
        // Just update state directly without animations
        const clientState = {
            players: serverState.players.map((p, idx) => ({
                id: p.id,
                hand: p.hand && p.hand.length > 0 ? p.hand : 
                      (p.handSize ? new Array(p.handSize).fill({ color: 'wild', value: 'back' }) : []),
                handSize: p.handSize || (p.hand ? p.hand.length : 0),
                name: p.name,
                hasUno: p.hasUno || false
            })),
            deck: new Array(serverState.deck.count || 0).fill(null),
            discardPile: serverState.discardPile || [],
            topCard: serverState.topCard,
            currentPlayerIndex: serverState.currentPlayerIndex,
            direction: serverState.direction,
            status: serverState.status,
            winner: serverState.winner,
            currentColor: serverState.currentColor,
            waitingForUno: serverState.waitingForUno || false
        };
        
        currentGameState = clientState;
        setGameState(currentGameState, localPlayerIndex);
        updateInputState();
        return;
    }
    
    // Convert server state to client format
    const clientState = {
        players: serverState.players.map((p, idx) => ({
            id: p.id,
            // Server sends empty array for opponents, but includes handSize
            // We need to create placeholder cards for rendering
            hand: p.hand && p.hand.length > 0 ? p.hand : 
                  (p.handSize ? new Array(p.handSize).fill({ color: 'wild', value: 'back' }) : []),
            handSize: p.handSize || (p.hand ? p.hand.length : 0), // Store handSize for comparison
            name: p.name,
            hasUno: p.hasUno || false
        })),
        deck: new Array(serverState.deck.count || 0).fill(null),
        discardPile: serverState.discardPile || [],
        topCard: serverState.topCard,
        currentPlayerIndex: serverState.currentPlayerIndex,
        direction: serverState.direction,
        status: serverState.status,
            winner: serverState.winner,
            currentColor: serverState.currentColor,
            waitingForUno: serverState.waitingForUno || false // Include UNO waiting flag
        };
    
    // Save previous state BEFORE updating (for comparison)
    const oldStateForComparison = currentGameState ? JSON.parse(JSON.stringify(currentGameState)) : null;
    
    // Detect if the turn changed (currentPlayerIndex changed)
    // If so, clear the old timer to prevent showing wrong countdown for new player
    // BUT: Only clear if the timer belongs to the old player
    // If turn_start already set the timer for the NEW player, preserve it
    let turnJustChanged = false;
    if (oldStateForComparison && oldStateForComparison.currentPlayerIndex !== clientState.currentPlayerIndex) {
        // Turn changed
        
        // Clear timer if it belongs to the old player or hasn't been set for the new player yet
        // Only preserve if turnTimerPlayerIndex matches the NEW currentPlayerIndex
        if (turnTimerPlayerIndex !== clientState.currentPlayerIndex) {
            // Clearing old timer
            turnExpiresAt = null;
            turnTimerPlayerIndex = null;
            if (currentGameState) {
                currentGameState.turnTimeRemaining = null;
            }
        } else {
            // Preserving timer set by turn_start event
        }
        
        turnJustChanged = true;
    }
    
    // Handle local player card draws (both manual and automatic from Draw 2/4)
    if (clientState.players[localPlayerIndex]) {
        const localPlayer = clientState.players[localPlayerIndex];
        const newHandSize = localPlayer.hand ? localPlayer.hand.length : 0;
        const oldLocalPlayer = currentGameState ? currentGameState.players[localPlayerIndex] : null;
        const oldHandSize = oldLocalPlayer ? (oldLocalPlayer.handSize !== undefined ? oldLocalPlayer.handSize : (oldLocalPlayer.hand ? oldLocalPlayer.hand.length : 0)) : 0;
        
        // If hand size increased, local player drew card(s)
        if (newHandSize > oldHandSize) {
            const cardsDrawn = newHandSize - oldHandSize;
            
            // If we have a pending draw animation (manual draw), update it with real card
            if (pendingDrawAnimation && cardsDrawn === 1) {
                if (newHandSize > 0 && localPlayer.hand[newHandSize - 1]) {
                    const realCard = localPlayer.hand[newHandSize - 1];
                    // Update placeholder card with real card data (for flip animation)
                    pendingDrawAnimation.card.color = realCard.color;
                    pendingDrawAnimation.card.value = realCard.value;
                }
            } else if (cardsDrawn > 1 || (!pendingDrawAnimation && cardsDrawn >= 1)) {
                // Automatic draw (Draw 2/4) or single card without pending animation - animate them
                const { width, height } = getCanvasContext();
                const deckPos = getDrawDeckPosition(width, height);
                
                // Check if there's a pending play animation (local or opponent) for a draw 2/4 card
                // If so, delay draw animations until play animation completes
                let playAnimationDelay = 0;
                const isDrawCardPlayed = (pendingPlayAnimation && 
                    (pendingPlayAnimation.card.value === 'draw2' || pendingPlayAnimation.card.value === 'draw4')) ||
                    (pendingOpponentPlayAnimation && 
                    (pendingOpponentPlayAnimation.card.value === 'draw2' || pendingOpponentPlayAnimation.card.value === 'draw4')) ||
                    (clientState.topCard && 
                    (clientState.topCard.value === 'draw2' || clientState.topCard.value === 'draw4'));
                
                // If a draw 2/4 was played (detected via pending animation or topCard), delay draw animations
                // This ensures draw animations start after the play animation completes
                if (isDrawCardPlayed) {
                    // Wait for play animation to complete before starting draw animations
                    playAnimationDelay = ANIMATION_DURATION;
                }
                
                // Initialize tracking for this player if needed
                if (!animatedCardIndices[localPlayerIndex]) {
                    animatedCardIndices[localPlayerIndex] = new Set();
                }
                
                // Animate each card being drawn sequentially
                for (let i = 0; i < cardsDrawn; i++) {
                    const cardIndex = oldHandSize + i;
                    const delay = playAnimationDelay + (i * 200); // Base delay + 200ms delay between each card
                    
                    // Mark this card index as being animated (so it won't render in hand)
                    animatedCardIndices[localPlayerIndex].add(cardIndex);
                    
                    setTimeout(() => {
                        const handPos = getCardHandPosition(cardIndex, newHandSize, width, height);
                        
                        // Get the real card if available, otherwise use placeholder
                        const card = (localPlayer.hand && localPlayer.hand[cardIndex]) 
                            ? { ...localPlayer.hand[cardIndex] } // Create a copy to avoid reference issues
                            : { color: 'wild', value: 'back' };
                        
                        // Animate card movement from deck to hand
                        animateCardMove(card, deckPos.x, deckPos.y, handPos.x, handPos.y, {
                            reveal: false,
                            onComplete: () => {
                                // After card reaches hand, flip it to reveal (for local player)
                                animateCardFlip(card, handPos.x, handPos.y, {
                                    onComplete: () => {
                                        // Card animation complete - remove from tracking so it renders in hand
                                        if (animatedCardIndices[localPlayerIndex]) {
                                            animatedCardIndices[localPlayerIndex].delete(cardIndex);
                                            // Clean up empty sets
                                            if (animatedCardIndices[localPlayerIndex].size === 0) {
                                                delete animatedCardIndices[localPlayerIndex];
                                            }
                                        }
                                    }
                                });
                            }
                        });
                    }, delay);
                }
            }
        }
    }
    
    // If there's a pending play animation (local player), don't add the new card to discard pile yet
    // The animation will add it when it completes
    // But preserve the old discard pile card so it doesn't disappear
    if (pendingPlayAnimation && clientState.topCard) {
        // Update the card data from server (in case of wild card color choice, etc.)
        pendingPlayAnimation.card.color = clientState.topCard.color;
        pendingPlayAnimation.card.value = clientState.topCard.value;
        // Update currentColor from server (important for wild cards)
        pendingPlayAnimation.currentColor = clientState.currentColor;
        // Keep the old topCard visible until animation completes
        // Don't update to the new topCard yet - animation will handle it
        if (currentGameState && currentGameState.topCard) {
            clientState.topCard = currentGameState.topCard;
            clientState.discardPile = [...currentGameState.discardPile];
        } else {
            // If no old card, still don't show new one yet
            clientState.topCard = null;
            clientState.discardPile = [];
        }
        // Keep currentColor from server for when animation completes
        // But don't update it in clientState yet - animation callback will handle it
    }
    
    // Detect opponent actions (draw or play cards) BEFORE updating state
    // This way we can preserve the old discard pile when opponent plays
    // Check if we have a previous state and game was in playing status (or just finished)
    // Skip for local player (they handle their own animations optimistically)
    let opponentPlayedCard = false;
    let opponentPlayedCardData = null;
    
    // Check for opponent actions if game was playing (or just finished - to catch winning card animation)
    if (oldStateForComparison && currentGameState && 
        oldStateForComparison.status === 'playing' && 
        (clientState.status === 'playing' || clientState.status === 'finished')) {
        // Skip if we're currently dealing cards
        if (!isDealingCards()) {
            // First pass: detect plays and start animations immediately
            clientState.players.forEach((newPlayer, playerIndex) => {
                // Skip local player (they handle their own animations)
                if (playerIndex === localPlayerIndex) return;
                
                const oldPlayer = oldStateForComparison.players[playerIndex];
                if (!oldPlayer) return;
                
                // Compare hand sizes - use consistent method
                const oldHandSize = oldPlayer.handSize !== undefined ? oldPlayer.handSize : (oldPlayer.hand ? oldPlayer.hand.length : 0);
                const newHandSize = newPlayer.handSize !== undefined ? newPlayer.handSize : (newPlayer.hand ? newPlayer.hand.length : 0);
                
                // If hand size decreased by exactly 1 and there's a topCard, opponent played a card
                // Start the play animation immediately so pendingOpponentPlayAnimation is set for draw delay checks
                if (newHandSize === oldHandSize - 1 && clientState.topCard) {
                    // Detected opponent played a card
                    opponentPlayedCard = true;
                    opponentPlayedCardData = {
                        playerIndex: playerIndex,
                        oldHandSize: oldHandSize,
                        playedCard: clientState.topCard
                    };
                    
                    // Check if this is an action card in 2-player mode that gives the same player another turn
                    // In 2-player mode: Skip, Reverse, Draw 2, and Draw 4 all give the same player another turn
                    const isTwoPlayerMode = clientState.players.length === 2;
                    const isActionCardGivingAnotherTurn = isTwoPlayerMode && (
                        clientState.topCard.value === 'skip' ||
                        clientState.topCard.value === 'reverse' ||
                        clientState.topCard.value === 'draw2' ||
                        clientState.topCard.value === 'draw4'
                    );
                    
                    // Clear timer if it's an action card in 2-player mode (same player gets another turn with fresh timer)
                    // OR if turn actually ends (handled by turn change detection)
                    // Don't clear if opponent needs to call UNO (turn continues, timer should keep running)
                    // Note: We check turn change later, but for action cards in 2-player mode, turn doesn't change
                    // so we need to clear it here
                    if (isActionCardGivingAnotherTurn) {
                        // Clear timer optimistically - same player will get fresh timer from turn_start event
                        if (turnTimerInterval) {
                            clearInterval(turnTimerInterval);
                            turnTimerInterval = null;
                        }
                        turnExpiresAt = null;
                        turnTimerPlayerIndex = null;
                        if (currentGameState) {
                            currentGameState.turnTimeRemaining = null;
                            // Update state immediately so timer disappears from UI
                            setGameState(currentGameState, localPlayerIndex);
                        }
                    }
                    // For non-action cards or if opponent needs UNO, timer clearing is handled by turn change detection
                    
                    // Start the play animation immediately
                    const oldTopCard = currentGameState ? currentGameState.topCard : null;
                    const oldDiscardPile = currentGameState ? [...currentGameState.discardPile] : [];
                    
                    // Pass the color from server state for wild cards
                    animateOpponentCardPlay(playerIndex, oldHandSize, clientState.topCard, clientState.currentColor);
                    
                    // Preserve old discard pile (animation will update it when done)
                    if (oldTopCard) {
                        clientState.topCard = oldTopCard;
                        clientState.discardPile = oldDiscardPile;
                    } else {
                        clientState.topCard = null;
                        clientState.discardPile = [];
                    }
                }
            });
            
            // Second pass: detect draws (now pendingOpponentPlayAnimation is set if a play happened)
            clientState.players.forEach((newPlayer, playerIndex) => {
                // Skip local player (they handle their own animations)
                if (playerIndex === localPlayerIndex) return;
                
                const oldPlayer = oldStateForComparison.players[playerIndex];
                if (!oldPlayer) return;
                
                // Compare hand sizes - use consistent method
                const oldHandSize = oldPlayer.handSize !== undefined ? oldPlayer.handSize : (oldPlayer.hand ? oldPlayer.hand.length : 0);
                const newHandSize = newPlayer.handSize !== undefined ? newPlayer.handSize : (newPlayer.hand ? newPlayer.hand.length : 0);
                
                // If hand size increased, opponent drew card(s) - could be 1 or multiple (Draw 2/4)
                if (newHandSize > oldHandSize) {
                    const cardsDrawn = newHandSize - oldHandSize;
                    // Detected opponent drew cards
                    
                    // Check if there's a pending play animation (local or opponent) for a draw 2/4 card
                    // If so, delay draw animations until play animation completes
                    let playAnimationDelay = 0;
                    const isDrawCardPlayed = (pendingPlayAnimation && 
                        (pendingPlayAnimation.card.value === 'draw2' || pendingPlayAnimation.card.value === 'draw4')) ||
                        (pendingOpponentPlayAnimation && 
                        (pendingOpponentPlayAnimation.card.value === 'draw2' || pendingOpponentPlayAnimation.card.value === 'draw4')) ||
                        (clientState.topCard && 
                        (clientState.topCard.value === 'draw2' || clientState.topCard.value === 'draw4'));
                    
                    if (isDrawCardPlayed && (pendingPlayAnimation || pendingOpponentPlayAnimation)) {
                        // Wait for play animation to complete before starting draw animations
                        playAnimationDelay = ANIMATION_DURATION;
                    }
                    
                    // Initialize tracking for this player if needed
                    if (!animatedCardIndices[playerIndex]) {
                        animatedCardIndices[playerIndex] = new Set();
                    }
                    
                    // Animate each card being drawn sequentially with a slight delay
                    for (let i = 0; i < cardsDrawn; i++) {
                        const cardIndex = oldHandSize + i;
                        const delay = playAnimationDelay + (i * 200); // Base delay + 200ms delay between each card
                        
                        // Mark this card index as being animated (so it won't render in hand)
                        animatedCardIndices[playerIndex].add(cardIndex);
                        
                        setTimeout(() => {
                            animateOpponentCardDraw(playerIndex, newHandSize, cardsDrawn, cardIndex);
                        }, delay);
                    }
                }
            });
        }
    }
    
    // Detect color change for wild cards (BEFORE handling pending animations)
    // This handles the case when an opponent plays a wild card and we receive the state update
    const oldColor = oldStateForComparison ? oldStateForComparison.currentColor : null;
    const newColor = clientState.currentColor;
    const topCardIsWild = clientState.topCard && (clientState.topCard.color === 'wild' || clientState.topCard.value === 'draw4');
    
    // If there's a pending opponent play animation, don't add the new card to discard pile yet
    // The animation will add it when it completes
    // But preserve the old discard pile card so it doesn't disappear
    // EXCEPT: If game is finished (win state), just use the server's state directly
    if (pendingOpponentPlayAnimation && clientState.topCard && clientState.status !== 'finished') {
        // Update the card data from server
        pendingOpponentPlayAnimation.card.color = clientState.topCard.color;
        pendingOpponentPlayAnimation.card.value = clientState.topCard.value;
        // Always update the color from server (important for wild cards)
        // Store it in pendingOpponentPlayAnimation so it's available in the onComplete callback
        pendingOpponentPlayAnimation.currentColor = clientState.currentColor;
        // Keep the old topCard visible until animation completes
        // Don't update to the new topCard yet - animation will handle it
        if (currentGameState && currentGameState.topCard) {
            clientState.topCard = currentGameState.topCard;
            clientState.discardPile = [...currentGameState.discardPile];
            // Preserve old color too (but we've stored the new one in pendingOpponentPlayAnimation)
            // clientState.currentColor will be updated after animation completes
        } else {
            // If no old card, still don't show new one yet
            clientState.topCard = null;
            clientState.discardPile = [];
        }
    }
    
    // Update current state
    currentGameState = clientState;
    
    // Trigger color animation if wild card was played and color changed
    // For opponent plays, the animation will be triggered in the onComplete callback
    // But we also trigger it here if there's no pending animation (for cases where animation already completed)
    if (!pendingPlayAnimation && topCardIsWild && newColor && newColor !== oldColor) {
        const colorImgs = getColorImages();
        if (colorImgs.loaded && colorImgs[newColor]) {
            // Only trigger if we don't have a pending opponent animation (it will trigger in onComplete)
            // OR if the opponent animation already completed
            if (!pendingOpponentPlayAnimation) {
                // Triggering color animation from server state update
                // Small delay to ensure card play animation has started or completed
                setTimeout(() => {
                    animateColorChange(colorImgs[newColor]);
                }, 200);
            }
        }
    }
    
    // Always update the timer when we receive a state update
    // This ensures the timer is in sync with the server
    updateTurnTimer();
    
    // Update previous state for next comparison
    previousGameState = oldStateForComparison;
    
    setGameState(currentGameState, localPlayerIndex);
    updateInputState();
}

/**
 * Update turn timer display (client-side countdown using expiresAt timestamp)
 * This is called every frame/100ms to update the countdown display
 */
function updateTurnTimer() {
    // Clear existing interval
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    
    // Basic checks: game must be playing
    if (!currentGameState || currentGameState.status !== 'playing') {
        if (currentGameState) {
            currentGameState.turnTimeRemaining = null;
        }
        return;
    }
    
    // If no expiresAt timestamp, the timer hasn't started yet
    // This is normal during dealing or when waiting for turn_start event
    if (turnExpiresAt === null) {
        if (currentGameState) {
            currentGameState.turnTimeRemaining = null;
        }
        return;
    }
    
    // Start countdown interval (update every 100ms for smooth display)
    // This works for both normal turns and when waiting for UNO (timer continues)
    turnTimerInterval = setInterval(() => {
        if (!currentGameState || currentGameState.status !== 'playing' || turnExpiresAt === null) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
            if (currentGameState) {
                currentGameState.turnTimeRemaining = null;
            }
            return;
        }
        
        // Calculate remaining time from server timestamp
        const remaining = Math.max(0, turnExpiresAt - Date.now());
        const remainingSeconds = Math.ceil(remaining / 1000);
        
        // Update state if changed
        if (currentGameState.turnTimeRemaining !== remainingSeconds) {
            currentGameState.turnTimeRemaining = remainingSeconds;
            setGameState(currentGameState, localPlayerIndex);
        }
        
        // If timer reaches 0, wait for server to send turn_timeout event
        if (remaining <= 0) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
            currentGameState.turnTimeRemaining = 0;
        }
    }, 100); // Update every 100ms for smooth countdown
}

/**
 * Handle turn_start event from server
 */
export function handleTurnStart(data) {
    // Turn start event received
    
    // Unblock actions when new turn starts
    // This is important for 2-player mode where action cards give the same player another turn
    if (actionsBlocked) {
        actionsBlocked = false;
        // Actions unblocked - new turn started
    }
    
    // Calculate clock offset if server sent its current time
    if (data.serverTime !== undefined) {
        const clientReceiveTime = Date.now();
        // Calculate offset: serverTime - clientTime (positive if server is ahead)
        serverTimeOffset = data.serverTime - clientReceiveTime;
    }
    
    // Adjust expiresAt by the clock offset to account for server/client time difference
    turnExpiresAt = data.expiresAt - serverTimeOffset;
    
    // Track which player this timer belongs to
    turnTimerPlayerIndex = data.playerIndex;
    
    // Initialize turnTimeRemaining immediately for display
    if (currentGameState) {
        const remaining = Math.max(0, turnExpiresAt - Date.now());
        const remainingSeconds = Math.ceil(remaining / 1000);
        currentGameState.turnTimeRemaining = remainingSeconds;
        setGameState(currentGameState, localPlayerIndex);
    }
    
    // Start the countdown timer
    updateTurnTimer();
    
    // Turn timer started
}

/**
 * Handle turn_timeout event from server
 */
export function handleTurnTimeout(data) {
    // If it's the local player's turn that timed out, hide color picker if visible
    // This prevents the player from being stuck with the color picker screen
    if (data.playerIndex === localPlayerIndex) {
        hideColorPicker();
    }
    
    // Only clear timer if it belongs to the player who timed out
    if (turnTimerPlayerIndex === data.playerIndex) {
        turnExpiresAt = null;
        turnTimerPlayerIndex = null;
        if (turnTimerInterval) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
        }
        if (currentGameState) {
            currentGameState.turnTimeRemaining = null;
        }
    }
    // If turnTimerPlayerIndex is different, it means turn_start already set a new timer for the next player
    // In that case, preserve the new timer
}

/**
 * Handle player disconnect event
 * @param {Object} data - Disconnect data from server
 */
export function handlePlayerDisconnected(data) {
    // Player disconnected
    
    // Update game state to reflect disconnected player
    if (currentGameState && currentGameState.players[data.disconnectedPlayerIndex]) {
        const disconnectedPlayer = currentGameState.players[data.disconnectedPlayerIndex];
        disconnectedPlayer.name = data.disconnectedPlayerName;
        disconnectedPlayer.disconnected = true;
        
        // If game ended due to disconnect, update status
        if (data.gameEnded) {
            currentGameState.status = 'finished';
            currentGameState.winner = data.winnerIndex;
        }
        
        // Update renderer
        setGameState(currentGameState, localPlayerIndex);
    }
    
    // Show disconnect message (will be displayed in renderer)
    // The server will send a game_state_update with the updated player names
}

/**
 * Calculate opponent hand position for card animation
 */
function calculateOpponentHandPosition(playerIndex, cardIndex, handSize, width, height) {
    const cardDims = getCardDimensions();
    const cardScale = getCardScale();
    const cardWidth = cardDims.width * cardScale;
    const cardHeight = cardDims.height * cardScale;
    const cardSpacing = getCardSpacing(handSize);
    const playerCount = currentGameState ? currentGameState.players.length : 2;
    const relativeIndex = playerIndex < localPlayerIndex ? playerIndex : playerIndex - 1;
    
    if (playerCount === 2) {
        // Only one opponent (top)
        const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
        const startX = (width - totalWidth) / 2;
        return {
            x: startX + (cardIndex * (cardWidth + cardSpacing)),
            y: 20, // OPPONENT_OFFSET_Y
            rotation: 0
        };
    } else if (playerCount === 3) {
        if (relativeIndex === 0) {
            // Top opponent
            const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
            const startX = (width - totalWidth) / 2;
            return {
                x: startX + (cardIndex * (cardWidth + cardSpacing)),
                y: 20,
                rotation: 0
            };
        } else {
            // Left opponent (vertical) - calculate exactly like renderOpponentHandVertical
            // Left side: rotate 90 degrees clockwise (Math.PI / 2) so top faces center
            const totalHeight = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
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
            const totalWidth = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
            const startX = (width - totalWidth) / 2;
            return {
                x: startX + (cardIndex * (cardWidth + cardSpacing)),
                y: 20,
                rotation: 0
            };
        } else if (relativeIndex === 1) {
            // Right opponent (vertical) - calculate exactly like renderOpponentHandVertical
            // Right side: rotate 90 degrees counter-clockwise (-Math.PI / 2) so top faces center
            const totalHeight = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
            const centerY = height / 2;
            const startY = centerY - totalHeight / 2;
            const cardY = startY + (cardIndex * (cardWidth + cardSpacing));
            return {
                x: width - 50 - cardWidth,
                y: cardY,
                rotation: -Math.PI / 2 // Right side: counter-clockwise rotation
            };
        } else {
            // Left opponent (vertical) - calculate exactly like renderOpponentHandVertical
            // Left side: rotate 90 degrees clockwise (Math.PI / 2) so top faces center
            const totalHeight = (handSize * cardWidth) + ((handSize - 1) * cardSpacing);
            const centerY = height / 2;
            const startY = centerY - totalHeight / 2;
            const cardY = startY + (cardIndex * (cardWidth + cardSpacing));
            return {
                x: 50,
                y: cardY,
                rotation: Math.PI / 2 // Left side: clockwise rotation
            };
        }
    }
    
    // Default fallback
    return { x: width / 2, y: 20, rotation: 0 };
}

/**
 * Animate card draw for opponent (when we receive state update showing opponent drew)
 * This is called when we detect an opponent drew a card from server state
 * @param {number} playerIndex - Index of the player who drew
 * @param {number} handSize - New hand size after drawing (total cards in hand)
 * @param {number} totalCardsDrawn - Total number of cards being drawn (for multiple draws)
 * @param {number} cardIndex - Index of the card in the hand
 */
function animateOpponentCardDraw(playerIndex, handSize, totalCardsDrawn = 1, cardIndex) {
    const { width, height } = getCanvasContext();
    const deckPos = getDrawDeckPosition(width, height);
    const handPos = calculateOpponentHandPosition(playerIndex, cardIndex, handSize, width, height);
    
    // Use placeholder card (face down) for opponent
    const placeholderCard = { color: 'wild', value: 'back' };
    
    // Animate movement with rotation for left/right opponents (no flip, card stays face down)
    animateCardMove(placeholderCard, deckPos.x, deckPos.y, handPos.x, handPos.y, {
        reveal: false,
        fromRotation: 0, // Start unrotated (from deck)
        toRotation: handPos.rotation || 0, // End with target rotation (for left/right opponents)
        onComplete: () => {
            // Card animation complete - remove from tracking so it renders in hand
            if (animatedCardIndices[playerIndex]) {
                animatedCardIndices[playerIndex].delete(cardIndex);
                // Clean up empty sets
                if (animatedCardIndices[playerIndex].size === 0) {
                    delete animatedCardIndices[playerIndex];
                }
            }
        }
    });
}

/**
 * Animate card play for opponent (when we receive state update showing opponent played)
 * This is called when we detect an opponent played a card from server state
 */
function animateOpponentCardPlay(playerIndex, oldHandSize, playedCard, newColor = null) {
    const { width, height } = getCanvasContext();
    const handPos = calculateOpponentHandPosition(playerIndex, oldHandSize - 1, oldHandSize, width, height);
    const discardPos = getDiscardPilePosition(width, height);
    
    // Track pending animation
    pendingOpponentPlayAnimation = {
        card: playedCard,
        discardPos: discardPos,
        currentColor: newColor // Store color from server for wild cards
    };
    
    // Preserve old discard pile card - don't update to new one yet
    // The old card will stay visible during animation
    
    // Create a placeholder card that starts face down (opponent's card)
    const placeholderCard = { color: 'wild', value: 'back' };
    
    let flipTriggered = false;
    
    // Start the movement animation with flip at midpoint
    // For left/right opponents, rotate from hand rotation to 0 (unrotated at discard pile)
    animateCardMove(placeholderCard, handPos.x, handPos.y, discardPos.x, discardPos.y, {
        reveal: false,
        duration: ANIMATION_DURATION,
        fromRotation: handPos.rotation || 0, // Start with hand rotation (for left/right opponents)
        toRotation: 0, // End unrotated (at discard pile)
        onUpdate: (progress) => {
            // Trigger flip at 50% progress (midpoint)
            if (!flipTriggered && progress >= 0.5) {
                flipTriggered = true;
                // Update card to real card
                placeholderCard.color = playedCard.color;
                placeholderCard.value = playedCard.value;
                // Start flip animation - it will follow the moving card's position and rotation
                const midX = (handPos.x + discardPos.x) / 2;
                const midY = (handPos.y + discardPos.y) / 2;
                animateCardFlip(placeholderCard, midX, midY);
            }
        },
        onComplete: () => {
            // After animation completes, add card to discard pile
            if (pendingOpponentPlayAnimation && currentGameState) {
                currentGameState.topCard = pendingOpponentPlayAnimation.card;
                if (!currentGameState.discardPile) {
                    currentGameState.discardPile = [];
                }
                currentGameState.discardPile.push(pendingOpponentPlayAnimation.card);
                const oldColor = currentGameState.currentColor;
                // For wild cards, use the color from server (stored in pendingOpponentPlayAnimation.currentColor)
                // For non-wild cards, use the card's color
                let newColor = null;
                if (pendingOpponentPlayAnimation.card.color === 'wild' || pendingOpponentPlayAnimation.card.value === 'draw4') {
                    // Use color from server if available, otherwise keep current
                    newColor = pendingOpponentPlayAnimation.currentColor || currentGameState.currentColor;
                } else {
                    newColor = pendingOpponentPlayAnimation.card.color;
                }
                currentGameState.currentColor = newColor;
                
                setGameState(currentGameState, localPlayerIndex);
                
                // Trigger special card animation if applicable
                const animImages = getAnimationImages();
                const colorImgs = getColorImages();
                if (animImages.loaded) {
                    if (pendingOpponentPlayAnimation.card.value === 'skip' && animImages.skip) {
                        animateSkipCard(animImages.skip);
                    } else if (pendingOpponentPlayAnimation.card.value === 'reverse' && animImages.reverse) {
                        animateReverseCard(animImages.reverse);
                    }
                }
                
                // Trigger color animation if wild card or draw 4 was played
                // Always trigger if it's a wild/draw4 card (color should be set from server)
                if (colorImgs.loaded && (pendingOpponentPlayAnimation.card.color === 'wild' || pendingOpponentPlayAnimation.card.value === 'draw4')) {
                    // Use the color we just set
                    const colorToUse = newColor;
                    if (colorToUse && colorImgs[colorToUse]) {
                        // Triggering color animation for opponent play
                        animateColorChange(colorImgs[colorToUse]);
                    } else {
                        // Color animation not triggered - missing color
                    }
                }
                
                pendingOpponentPlayAnimation = null;
            }
        }
    });
}

export function hasPendingDrawAnimation() {
    return pendingDrawAnimation !== null;
}

/**
 * Check if a card at a specific index is being animated for a player
 * @param {number} playerIndex - Index of the player
 * @param {number} cardIndex - Index of the card in the hand
 * @returns {boolean} True if the card is being animated
 */
export function isCardIndexAnimating(playerIndex, cardIndex) {
    return animatedCardIndices[playerIndex] && animatedCardIndices[playerIndex].has(cardIndex);
}

/**
 * Check if there's a pending discard pile card animation
 */
export function hasPendingDiscardPileCard() {
    return pendingDiscardPileCard !== null;
}

/**
 * Check if there's a pending play animation
 */
export function hasPendingPlayAnimation() {
    return pendingPlayAnimation !== null;
}

/**
 * Check if there's a pending opponent play animation
 */
export function hasPendingOpponentPlayAnimation() {
    return pendingOpponentPlayAnimation !== null;
}

/**
 * Get the expected hand size during a pending draw animation
 * This helps the renderer know which card to skip
 */
export function getPendingDrawHandSize() {
    if (!pendingDrawAnimation || !currentGameState || !currentGameState.players[localPlayerIndex]) {
        return null;
    }
    const localPlayer = currentGameState.players[localPlayerIndex];
    return localPlayer.hand ? localPlayer.hand.length : 0;
}

// Make updateGameStateFromServer available globally for socket callbacks
window.updateGameStateFromServer = updateGameStateFromServer;

/**
 * Stop the game
 */
export function stopGame() {
    isGameActive = false;
    currentGameState = null;
    turnExpiresAt = null;
    turnTimerPlayerIndex = null;
    actionsBlocked = false;
    
    // Clear timer interval
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    
    // Clear animated card indices tracking
    animatedCardIndices = {};
}

