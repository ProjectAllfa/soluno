/**
 * Server-Side UNO Game Logic
 * Authoritative game state management
 */

// Card structure: { color: 'red'|'green'|'blue'|'yellow'|'wild', value: '0'-'9'|'skip'|'reverse'|'draw2'|'wild'|'draw4' }

/**
 * Create a full UNO deck (108 cards)
 */
function createDeck() {
    const deck = [];
    const colors = ['red', 'green', 'blue', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
    
    // Add colored cards (0-9, skip, reverse, draw2)
    colors.forEach(color => {
        values.forEach(value => {
            const count = value === '0' ? 1 : 2; // Only one 0 per color
            for (let i = 0; i < count; i++) {
                deck.push({ color, value });
            }
        });
    });
    
    // Add wild cards (4 wild, 4 wild draw 4)
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'wild' });
        deck.push({ color: 'wild', value: 'draw4' });
    }
    
    return deck;
}

/**
 * Shuffle deck using Fisher-Yates algorithm
 */
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Check if player has any playable cards in hand
 * @param {Array} playerHand - Player's hand
 * @param {Object} topCard - Top card on discard pile
 * @param {string} currentColor - Current color in play
 * @returns {boolean} True if player has at least one playable card
 */
function hasPlayableCard(playerHand, topCard, currentColor) {
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
 * Reshuffle discard pile into deck (except top card)
 */
function reshuffleDeck(gameState) {
    if (gameState.discardPile.length <= 1) {
        console.error('Cannot reshuffle: not enough cards');
        return;
    }
    
    const topCard = gameState.discardPile.pop();
    const cardsToReshuffle = gameState.discardPile.length;
    gameState.deck = shuffleDeck([...gameState.discardPile]);
    gameState.discardPile = [topCard];
    
    console.log(`🔄 DECK RESHUFFLED: ${cardsToReshuffle} cards reshuffled from discard pile. New deck size: ${gameState.deck.length}`);
}

/**
 * Move to next player's turn
 */
function nextTurn(gameState) {
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + gameState.direction + gameState.players.length) % gameState.players.length;
    gameState.hasDrawnPlayableCard = false; // Reset flag when turn changes
    gameState.hasPlayedCardThisTurn = false; // Reset flag when turn changes
    gameState.waitingForUno = false; // Reset UNO waiting flag when turn changes
    
    // Reset hasUno for all players when turn changes (each turn is a fresh opportunity)
    // This ensures if a player called UNO in a previous turn, they need to call it again if they have 1 card
    gameState.players.forEach(player => {
        player.hasUno = false;
    });
}

/**
 * Game class - manages a single game instance
 */
export class Game {
    constructor(playerIds, playerNames, playerWallets = []) {
        this.gameState = {
            players: [],
            deck: [],
            discardPile: [],
            topCard: null,
            currentPlayerIndex: 0,
            direction: 1, // 1 = clockwise, -1 = counterclockwise
            status: 'dealing', // 'dealing', 'playing', 'finished'
            winner: null,
            currentColor: null,
            hasDrawnPlayableCard: false, // Track if current player has drawn a playable card and is waiting to decide
            hasPlayedCardThisTurn: false, // Track if current player has already played a card this turn
            waitingForUno: false // Track if current player must call UNO before turn can end
        };
        
        // Turn timer management
        this.turnTimer = null;
        this.turnStartTime = null;
        this.turnExpiresAt = null; // Timestamp when current turn expires
        this.turnTimeLimit = 15000; // 15 seconds in milliseconds
        this.dealingAnimationDelay = 5000; // 5 seconds delay to allow dealing animation to complete
        this.ANIMATION_DURATION = 1200; // Animation duration in ms (must match client)
        this.onStateChangeCallback = null; // Callback to notify server of state changes
        this.onTurnStartCallback = null; // Callback to send turn_start event
        this.onTurnTimeoutCallback = null; // Callback to send turn_timeout event
        
        // Create players
        playerIds.forEach((id, index) => {
            this.gameState.players.push({
                id: id,
                socketId: id, // For now, using id as socketId
                hand: [],
                name: playerNames[index] || `Player ${index + 1}`,
                wallet: playerWallets[index] || null,
                hasUno: false
            });
        });
        
        // Create and shuffle deck
        this.gameState.deck = shuffleDeck(createDeck());
        
        // Deal 7 cards to each player
        this.dealCards();
    }
    
    /**
     * Start turn timer for current player
     */
    startTurnTimer() {
        // Clear any existing timer
        this.clearTurnTimer();
        
        // Only start timer if game is in playing state
        if (this.gameState.status !== 'playing') {
            return;
        }
        
        // Validate players array and current player index
        if (!this.gameState.players || this.gameState.players.length === 0) {
            console.error('[startTurnTimer] ERROR: Players array is empty!');
            return;
        }
        
        if (this.gameState.currentPlayerIndex < 0 || this.gameState.currentPlayerIndex >= this.gameState.players.length) {
            console.error(`[startTurnTimer] ERROR: Invalid currentPlayerIndex ${this.gameState.currentPlayerIndex} (players.length: ${this.gameState.players.length})`);
            return;
        }
        
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        if (!currentPlayer) {
            console.error(`[startTurnTimer] ERROR: Current player is undefined at index ${this.gameState.currentPlayerIndex}`);
            return;
        }
        
        this.turnStartTime = Date.now();
        this.turnExpiresAt = this.turnStartTime + this.turnTimeLimit;
        
        // Send turn_start event to all players
        if (this.onTurnStartCallback) {
            this.onTurnStartCallback({
                playerId: currentPlayer.id,
                playerIndex: this.gameState.currentPlayerIndex,
                expiresAt: this.turnExpiresAt,
                serverTime: this.turnStartTime // Include server time for client clock sync
            });
        }
        
        // Set timer to auto-punish after 15 seconds
        this.turnTimer = setTimeout(() => {
            this.handleTurnTimeout();
        }, this.turnTimeLimit);
    }
    
    /**
     * Start turn timer with a specific duration (for continuing existing turn)
     * @param {number} duration - Duration in milliseconds
     */
    startTurnTimerWithDuration(duration) {
        // Clear any existing timer
        this.clearTurnTimer();
        
        // Only start timer if game is in playing state
        if (this.gameState.status !== 'playing') {
            return;
        }
        
        // Validate players array and current player index
        if (!this.gameState.players || this.gameState.players.length === 0) {
            console.error('[startTurnTimerWithDuration] ERROR: Players array is empty!');
            return;
        }
        
        if (this.gameState.currentPlayerIndex < 0 || this.gameState.currentPlayerIndex >= this.gameState.players.length) {
            console.error(`[startTurnTimerWithDuration] ERROR: Invalid currentPlayerIndex ${this.gameState.currentPlayerIndex} (players.length: ${this.gameState.players.length})`);
            return;
        }
        
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        if (!currentPlayer) {
            console.error(`[startTurnTimerWithDuration] ERROR: Current player is undefined at index ${this.gameState.currentPlayerIndex}`);
            return;
        }
        
        this.turnStartTime = Date.now();
        this.turnExpiresAt = this.turnStartTime + duration;
        
        // Send turn_start event to all players with updated expiration
        if (this.onTurnStartCallback) {
            this.onTurnStartCallback({
                playerId: currentPlayer.id,
                playerIndex: this.gameState.currentPlayerIndex,
                expiresAt: this.turnExpiresAt,
                serverTime: this.turnStartTime // Include server time for client clock sync
            });
        }
        
        // Set timer with remaining duration
        this.turnTimer = setTimeout(() => {
            this.handleTurnTimeout();
        }, duration);
    }
    
    /**
     * Clear turn timer
     */
    clearTurnTimer() {
        if (this.turnTimer) {
            clearTimeout(this.turnTimer);
            this.turnTimer = null;
        }
        this.turnStartTime = null;
        this.turnExpiresAt = null;
    }
    
    /**
     * Handle turn timeout - auto draw 1 card and end turn
     */
    handleTurnTimeout() {
        if (this.gameState.status !== 'playing') {
            return;
        }
        
        // If timer was already cleared (player took action), ignore timeout
        if (this.turnExpiresAt === null) {
            console.log('Turn timeout ignored - timer was already cleared');
            return;
        }
        
        const currentPlayerIndex = this.gameState.currentPlayerIndex;
        const currentPlayer = this.gameState.players[currentPlayerIndex];
        
        console.log(`Turn timeout for player ${currentPlayer.name} (${currentPlayer.id})`);
        
        // Check for UNO penalty: if player has 1 card and didn't call UNO, draw 2 cards
        // Only apply penalty if waitingForUno is true (they played a card and went from 2+ to 1 card)
        // If they started their turn with 1 card, normal timeout penalty applies (draw 1 card)
        if (this.gameState.waitingForUno && currentPlayer.hand.length === 1 && !currentPlayer.hasUno) {
            console.log(`UNO penalty: Player ${currentPlayer.name} didn't call UNO, drawing 2 cards`);
            // Draw 2 cards as penalty
            for (let i = 0; i < 2; i++) {
                if (this.gameState.deck.length === 0) {
                    reshuffleDeck(this.gameState);
                }
                currentPlayer.hand.push(this.gameState.deck.pop());
            }
            // Reset hasUno since they now have more than 1 card
            currentPlayer.hasUno = false;
            // Clear waitingForUno flag
            this.gameState.waitingForUno = false;
        } else if (this.gameState.hasDrawnPlayableCard) {
            // Player drew a playable card but didn't decide - end turn without additional penalty
            console.log(`Player ${currentPlayer.name} drew a playable card but didn't play it - ending turn`);
            // The card is already in their hand, just clear the flag
            this.gameState.hasDrawnPlayableCard = false;
        } else {
            // Normal timeout: Draw 1 card as punishment
            if (this.gameState.deck.length === 0) {
                reshuffleDeck(this.gameState);
            }
            const drawnCard = this.gameState.deck.pop();
            currentPlayer.hand.push(drawnCard);
            // Reset hasUno if hand size is now greater than 1
            if (currentPlayer.hand.length > 1) {
                currentPlayer.hasUno = false;
            }
            // Clear waitingForUno flag if it was set
            this.gameState.waitingForUno = false;
        }
        
        // End turn automatically
        this.gameState.hasDrawnPlayableCard = false;
        
        // Move to next player (skip disconnected players)
        nextTurn(this.gameState);
        
        // Skip disconnected players
        while (this.gameState.players[this.gameState.currentPlayerIndex].disconnected) {
            const nextIndex = (this.gameState.currentPlayerIndex + this.gameState.direction + this.gameState.players.length) % this.gameState.players.length;
            
            // Safety check - if all players are disconnected, pause the game
            if (nextIndex === currentPlayerIndex) {
                this.clearTurnTimer();
                console.log('All players disconnected - pausing game');
                return;
            }
            
            this.gameState.currentPlayerIndex = nextIndex;
        }
        
        // Start timer for next active player
        this.startTurnTimer();
        
        // Send turn_timeout event
        if (this.onTurnTimeoutCallback) {
            this.onTurnTimeoutCallback({
                playerId: currentPlayer.id,
                playerIndex: currentPlayerIndex
            });
        }
        
        // Notify server to broadcast state update
        if (this.onStateChangeCallback) {
            this.onStateChangeCallback();
        }
    }
    
    /**
     * Set callback for state changes (used by server to broadcast updates)
     */
    setStateChangeCallback(callback) {
        this.onStateChangeCallback = callback;
    }
    
    /**
     * Set callback for turn start events
     */
    setTurnStartCallback(callback) {
        this.onTurnStartCallback = callback;
    }
    
    /**
     * Set callback for turn timeout events
     */
    setTurnTimeoutCallback(callback) {
        this.onTurnTimeoutCallback = callback;
    }
    
    /**
     * Deal cards to players (server-side, but we'll send them one by one for animation)
     */
    dealCards() {
        const cardsPerPlayer = 7;
        const playerCount = this.gameState.players.length;
        
        // Deal cards in rotation (one card to each player, repeat)
        for (let cardIndex = 0; cardIndex < cardsPerPlayer; cardIndex++) {
            for (let playerIndex = 0; playerIndex < playerCount; playerIndex++) {
                if (this.gameState.deck.length > 0) {
                    const card = this.gameState.deck.pop();
                    this.gameState.players[playerIndex].hand.push(card);
                }
            }
        }
    }
    
    /**
     * Draw first card to discard pile (after dealing animation)
     */
    drawFirstCard() {
        if (this.gameState.deck.length === 0) {
            reshuffleDeck(this.gameState);
        }
        
        let firstCard = this.gameState.deck.pop();
        
        // If first card is a wild, assign random color
        if (firstCard.color === 'wild') {
            const colors = ['red', 'green', 'blue', 'yellow'];
            firstCard.color = colors[Math.floor(Math.random() * colors.length)];
        }
        
        // Handle first card special effects
        if (firstCard.value === 'skip') {
            this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + this.gameState.direction) % this.gameState.players.length;
        } else if (firstCard.value === 'reverse') {
            if (this.gameState.players.length === 2) {
                this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + this.gameState.direction) % this.gameState.players.length;
            } else {
                this.gameState.direction = -1;
            }
        }
        
        this.gameState.discardPile.push(firstCard);
        this.gameState.topCard = firstCard;
        this.gameState.currentColor = firstCard.color;
        this.gameState.status = 'playing';
        
        // Delay starting timer to allow dealing animation to complete on clients
        // This ensures all players see the full timer countdown regardless of their client performance
        setTimeout(() => {
            this.startTurnTimer();
        }, this.dealingAnimationDelay);
    }
    
    /**
     * Play a card (server-authoritative)
     * @param {string} playerId - Player ID
     * @param {number} cardIndex - Index of card in player's hand
     * @param {string} chosenColor - Color chosen for wild card (optional)
     * @returns {Object} Result object
     */
    playCard(playerId, cardIndex, chosenColor = null) {
        if (this.gameState.status !== 'playing') {
            return { success: false, message: 'Game is not in playing state' };
        }
        
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found' };
        }
        
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: 'Not your turn' };
        }
        
        // If player is waiting to call UNO, they cannot play another card
        if (this.gameState.waitingForUno) {
            return { success: false, message: 'You must call UNO first' };
        }
        
        const player = this.gameState.players[playerIndex];
        
        // Prevent playing another card if:
        // 1. Player has 1 card and hasn't called UNO
        // 2. AND they've already played a card this turn (not a new turn from action card)
        // This allows playing the last card if it's a new turn started by an action card
        if (player.hand.length === 1 && !player.hasUno && this.gameState.hasPlayedCardThisTurn) {
            return { success: false, message: 'You must call UNO before playing another card' };
        }
        
        if (cardIndex < 0 || cardIndex >= player.hand.length) {
            return { success: false, message: 'Invalid card index' };
        }
        
        const card = player.hand[cardIndex];
        
        // Check if card can be played (pass player hand for Wild Draw 4 validation)
        if (!canPlayCard(card, this.gameState.topCard, this.gameState.currentColor, player.hand)) {
            if (card.color === 'wild' && card.value === 'draw4') {
                return { success: false, message: 'Cannot play Wild Draw 4: You have a card matching the current color' };
            }
            return { success: false, message: 'Cannot play this card' };
        }
        
        // Official UNO rules: Stacking is not allowed - you cannot play a Draw 2/4 to avoid drawing cards yourself.
        // However, if it's your turn again (after opponent drew and skipped), you CAN play draw cards.
        // Since the code immediately makes the next player draw, there's no "pending penalty" state.
        // The canPlayCard function already validates if the card can be played based on color/value matching.
        // No additional stacking validation needed here - if it's your turn and the card matches, you can play it.
        
        // Remove card from player's hand
        player.hand.splice(cardIndex, 1);
        
        // Mark that player has played a card this turn
        this.gameState.hasPlayedCardThisTurn = true;
        
        // Add card to discard pile (must be done before win check so winning card is visible)
        this.gameState.discardPile.push(card);
        this.gameState.topCard = card;
        
        // Set current color (needed for display, especially for wild cards)
        // This must be done before win check so the card displays correctly
        if (card.color === 'wild') {
            // Wild card - player must choose color
            if (!chosenColor || !['red', 'green', 'blue', 'yellow'].includes(chosenColor)) {
                // Default to red if invalid color
                this.gameState.currentColor = 'red';
            } else {
                this.gameState.currentColor = chosenColor;
            }
        } else {
            this.gameState.currentColor = card.color;
        }
        
        // Check for win (after adding card to discard pile so it's visible)
        if (player.hand.length === 0) {
            this.gameState.status = 'finished';
            this.gameState.winner = playerIndex;
            // Clear turn timer since game is over
            this.clearTurnTimer();
            return { success: true, message: 'Player wins!', gameState: this.getPublicState() };
        }
        
        // Check if the card played will give this player another turn (in 2-player mode only)
        // In 2-player mode: Skip/Reverse/Draw2/Draw4 all give player another turn
        // In 3-4 player mode: These cards affect other players, so player still needs to call UNO
        const isActionCardGivingAnotherTurn = (
            this.gameState.players.length === 2 && (
                (card.value === 'skip') ||
                (card.value === 'reverse') ||
                (card.value === 'draw2') ||
                (card.value === 'draw4')
            )
        );
        
        // Check for UNO: If player has 1 card left and hasn't called UNO, set waiting flag
        // BUT: Only require UNO if they played a card this turn (went from 2+ cards to 1 card)
        // If they started their turn with 1 card, they don't need to call UNO
        // BUT: Skip this check if an action card will give them another turn
        // (their turn will end and come back to them as a new turn)
        if (player.hand.length === 1 && !player.hasUno && !isActionCardGivingAnotherTurn && this.gameState.hasPlayedCardThisTurn) {
            // Set waiting for UNO flag - blocks all other actions until UNO is called
            this.gameState.waitingForUno = true;
            
            // Reset the hasDrawnPlayableCard flag since player is playing a card
            this.gameState.hasDrawnPlayableCard = false;
            
            // Clear any transition flag
            this.turnTransitioning = false;
            
            // Broadcast state change immediately so all players see the new discard pile card
            if (this.onStateChangeCallback) {
                this.onStateChangeCallback();
            }
            
            // Turn doesn't continue - player can't play/draw, only call UNO
            // Turn will end when they call UNO or when turn times out (penalty will apply)
            return { success: true, message: 'Card played - call UNO!', gameState: this.getPublicState() };
        }
        
        // Handle special card effects (only needed if game continues)
        let skipTurn = false;
        let drawAmount = 0; // Amount of cards to automatically draw for next player
        
        if (card.value === 'draw4') {
            // Official UNO rules: NO STACKING - draw exactly 4 cards
            drawAmount = 4;
            skipTurn = true;
        } else if (card.value === 'skip') {
            skipTurn = true;
        } else if (card.value === 'reverse') {
            this.gameState.direction *= -1;
            // With 2 players, reverse acts like skip
            if (this.gameState.players.length === 2) {
                skipTurn = true;
            }
        } else if (card.value === 'draw2') {
            // Official UNO rules: NO STACKING - draw exactly 2 cards
            drawAmount = 2;
            skipTurn = true;
        }
        
        // Reset the hasDrawnPlayableCard flag since player is playing a card
        this.gameState.hasDrawnPlayableCard = false;
        
        // Clear timer since player took action
        this.clearTurnTimer();
        
        // Calculate animation delay: play animation + draw animation delay if draw 2/4
        const playAnimationDelay = this.ANIMATION_DURATION;
        const drawAnimationDelay = drawAmount > 0 ? this.ANIMATION_DURATION : 0;
        const totalDelay = playAnimationDelay + drawAnimationDelay;
        
        // Broadcast state change immediately so all players see the new discard pile card
        // This allows the play animation to complete and show the new card right away
        if (this.onStateChangeCallback) {
            this.onStateChangeCallback();
        }
        
        // Immediately end current player's turn (prevents them from playing multiple cards)
        // But delay starting the next player's turn timer to allow animations to complete
        if (!skipTurn) {
            nextTurn(this.gameState);
            // Delay starting timer for next player
            setTimeout(() => {
                this.startTurnTimer();
                // Broadcast state change after turn timer starts
                if (this.onStateChangeCallback) {
                    this.onStateChangeCallback();
                }
            }, playAnimationDelay);
        } else {
            // Move to next player (who will draw cards)
            nextTurn(this.gameState);
            
            // If draw2 or draw4 was played, automatically draw cards for the next player
            if (drawAmount > 0) {
                const nextPlayerIndex = this.gameState.currentPlayerIndex;
                const nextPlayer = this.gameState.players[nextPlayerIndex];
                
                // Draw the cards automatically
                for (let i = 0; i < drawAmount; i++) {
                    if (this.gameState.deck.length === 0) {
                        reshuffleDeck(this.gameState);
                    }
                    nextPlayer.hand.push(this.gameState.deck.pop());
                }
            }
            
            // Skip their turn (move to next player again)
            nextTurn(this.gameState);
            // Delay starting timer for next player
            setTimeout(() => {
                this.startTurnTimer();
                // Broadcast state change after turn timer starts
                if (this.onStateChangeCallback) {
                    this.onStateChangeCallback();
                }
            }, totalDelay);
        }
        
        return { success: true, message: 'Card played', gameState: this.getPublicState() };
    }
    
    /**
     * Draw a card from the deck (server-authoritative)
     * @param {string} playerId - Player ID
     * @returns {Object} Result object
     */
    drawCard(playerId) {
        if (this.gameState.status !== 'playing') {
            return { success: false, message: 'Game is not in playing state' };
        }
        
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found' };
        }
        
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: 'Not your turn' };
        }
        
        // If player is waiting to call UNO, they cannot draw
        if (this.gameState.waitingForUno) {
            return { success: false, message: 'You must call UNO first' };
        }
        
        const player = this.gameState.players[playerIndex];
        
        // Save remaining time before clearing timer
        let remainingTime = this.turnTimeLimit;
        if (this.turnExpiresAt) {
            remainingTime = Math.max(0, this.turnExpiresAt - Date.now());
        }
        
        // Clear timer since player took action (but we'll restart it with remaining time if card is playable)
        this.clearTurnTimer();
        
        // Normal draw - check if player has playable cards first
        // Player can only draw if they don't have any playable cards
        if (this.gameState.hasDrawnPlayableCard) {
            // Player already drew a playable card and must decide to play it or end turn
            return { success: false, message: 'You must play the drawn card or end your turn' };
        }
        
        // Check if player has any playable cards in hand (excluding the card they just drew)
        const hasPlayable = hasPlayableCard(player.hand, this.gameState.topCard, this.gameState.currentColor);
        if (hasPlayable) {
            return { success: false, message: 'You have a playable card. You must play a card before drawing.' };
        }
        
        // Normal draw
        if (this.gameState.deck.length === 0) {
            reshuffleDeck(this.gameState);
        }
        
        const drawnCard = this.gameState.deck.pop();
        this.gameState.players[playerIndex].hand.push(drawnCard);
        
        // Reset hasUno if hand size is now greater than 1 (they had 1 card, called UNO, then drew)
        if (player.hand.length > 1) {
            player.hasUno = false;
        }
        
        // After drawing, check if card can be played
        // Pass player hand for Wild Draw 4 validation
        const canPlay = canPlayCard(drawnCard, this.gameState.topCard, this.gameState.currentColor, player.hand);
        
        if (canPlay) {
            // Card is playable - player can choose to play it or end turn
            this.gameState.hasDrawnPlayableCard = true;
            
            // Restart turn timer with remaining time (continue the same turn timer)
            this.startTurnTimerWithDuration(remainingTime);
            
            return { 
                success: true, 
                message: 'Card drawn - you can play it or end your turn', 
                card: drawnCard,
                canPlayImmediately: true,
                mustDecide: true, // Flag to indicate player must decide
                gameState: this.getPublicState() 
            };
        } else {
            // Card is not playable - turn ends automatically (official UNO rule: draw once, if not playable, turn ends)
            nextTurn(this.gameState);
            
            // Small delay before starting next turn's timer (to allow draw animation to complete)
            setTimeout(() => {
                this.startTurnTimer(); // Start timer for next player
                
                // Broadcast state change after turn timer starts
                if (this.onStateChangeCallback) {
                    this.onStateChangeCallback();
                }
            }, this.ANIMATION_DURATION);
            
            return { 
                success: true, 
                message: 'Card drawn - not playable, turn ends', 
                card: drawnCard,
                canPlayImmediately: false,
                gameState: this.getPublicState() 
            };
        }
    }
    
    /**
     * End turn (for when player draws a playable card but chooses not to play it)
     * @param {string} playerId - Player ID
     * @returns {Object} Result object
     */
    endTurn(playerId) {
        if (this.gameState.status !== 'playing') {
            return { success: false, message: 'Game is not in playing state' };
        }
        
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found' };
        }
        
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: 'Not your turn' };
        }
        
        // Only allow ending turn if player has drawn a playable card
        if (!this.gameState.hasDrawnPlayableCard) {
            return { success: false, message: 'You can only end your turn after drawing a playable card' };
        }
        
        // Clear timer since player took action
        this.clearTurnTimer();
        
        // Reset flag and move to next player
        this.gameState.hasDrawnPlayableCard = false;
        nextTurn(this.gameState);
        
        // Small delay before starting next turn's timer (to allow animation to complete)
        setTimeout(() => {
            this.startTurnTimer(); // Start timer for next player
            
            // Broadcast state change after turn timer starts
            if (this.onStateChangeCallback) {
                this.onStateChangeCallback();
            }
        }, this.ANIMATION_DURATION);
        
        return { success: true, message: 'Turn ended', gameState: this.getPublicState() };
    }
    
    /**
     * Call UNO (server-authoritative)
     * @param {string} playerId - Player ID
     * @returns {Object} Result object
     */
    callUno(playerId) {
        if (this.gameState.status !== 'playing') {
            return { success: false, message: 'Game is not in playing state' };
        }
        
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found' };
        }
        
        if (playerIndex !== this.gameState.currentPlayerIndex) {
            return { success: false, message: 'Not your turn' };
        }
        
        const player = this.gameState.players[playerIndex];
        if (player.hand.length === 1 && !player.hasUno) {
            player.hasUno = true;
            
            // After calling UNO, end the turn and move to next player
            // Reset the hasDrawnPlayableCard flag
            this.gameState.hasDrawnPlayableCard = false;
            
            // Clear timer since player took action
            this.clearTurnTimer();
            
            // Broadcast state change immediately
            if (this.onStateChangeCallback) {
                this.onStateChangeCallback();
            }
            
            // End current player's turn and move to next player
            nextTurn(this.gameState);
            
            // Delay starting timer for next player to allow animations
            setTimeout(() => {
                this.startTurnTimer();
                // Broadcast state change after turn timer starts
                if (this.onStateChangeCallback) {
                    this.onStateChangeCallback();
                }
            }, this.ANIMATION_DURATION);
            
            return { success: true, message: 'UNO called', gameState: this.getPublicState() };
        }
        return { success: false, message: 'Cannot call UNO' };
    }
    
    /**
     * Get public game state (hides opponent hands)
     * @param {string} playerId - Player ID to get state for
     * @returns {Object} Public game state
     */
    getPublicState(playerId = null) {
        // Calculate remaining time for current player
        let turnTimeRemaining = null;
        if (this.turnStartTime && this.gameState.status === 'playing') {
            const elapsed = Date.now() - this.turnStartTime;
            const remaining = Math.max(0, this.turnTimeLimit - elapsed);
            turnTimeRemaining = Math.ceil(remaining / 1000); // Convert to seconds
        }
        
        const publicState = {
            waitingForUno: this.gameState.waitingForUno || false, // Include UNO waiting flag
            players: this.gameState.players.map((player, index) => {
                // Hide opponent hands, show only card count
                if (playerId && player.id !== playerId) {
                    return {
                        id: player.id,
                        name: player.name,
                        hand: [], // Hide hand
                        handSize: player.hand.length,
                        hasUno: player.hasUno
                    };
                }
                // Show full hand for the requesting player
                return {
                    id: player.id,
                    name: player.name,
                    hand: player.hand,
                    handSize: player.hand.length,
                    hasUno: player.hasUno
                };
            }),
            deck: {
                count: this.gameState.deck.length
            },
            discardPile: this.gameState.discardPile,
            topCard: this.gameState.topCard,
            currentPlayerIndex: this.gameState.currentPlayerIndex,
            direction: this.gameState.direction,
            status: this.gameState.status,
            winner: this.gameState.winner,
            currentColor: this.gameState.currentColor,
            hasDrawnPlayableCard: this.gameState.hasDrawnPlayableCard
        };
        
        return publicState;
    }
    
    /**
     * Handle player disconnection
     * @param {string} playerId - ID of disconnected player
     * @returns {Object} Result object with disconnect info
     */
    handlePlayerDisconnect(playerId) {
        const playerIndex = this.gameState.players.findIndex(p => p.id === playerId);
        
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found in game' };
        }
        
        const disconnectedPlayer = this.gameState.players[playerIndex];
        
        // If game is already finished, just mark player as disconnected
        if (this.gameState.status === 'finished') {
            return {
                success: true,
                disconnectedPlayerIndex: playerIndex,
                disconnectedPlayerName: disconnectedPlayer.name,
                gameEnded: false
            };
        }
        
        // Store original name before marking as disconnected (for reconnection)
        const originalName = disconnectedPlayer.name.replace(' (Disconnected)', '');
        disconnectedPlayer.originalName = originalName;
        
        // Mark player as disconnected (keep in players array but mark status)
        disconnectedPlayer.disconnected = true;
        disconnectedPlayer.name = `${originalName} (Disconnected)`;
        
        // Don't end their turn immediately - let the timer continue
        // The turn will end naturally when the timer expires via handleTurnTimeout()
        // This allows the player to reconnect and continue their turn if they come back in time
        
        return {
            success: true,
            disconnectedPlayerIndex: playerIndex,
            disconnectedPlayerName: disconnectedPlayer.name,
            gameEnded: false
        };
    }
    
    /**
     * Handle player reconnection
     * @param {string} oldPlayerId - Old player ID (from before disconnect)
     * @param {string} newPlayerId - New player ID (new socket ID)
     * @param {string} playerName - Player name
     * @returns {Object} Result object
     */
    handlePlayerReconnect(oldPlayerId, newPlayerId, playerName) {
        const playerIndex = this.gameState.players.findIndex(p => 
            p.id === oldPlayerId || 
            (p.originalName || p.name.replace(' (Disconnected)', '')) === playerName
        );
        
        if (playerIndex === -1) {
            return { success: false, message: 'Player not found in game' };
        }
        
        const player = this.gameState.players[playerIndex];
        
        // Update player ID and socket ID
        player.id = newPlayerId;
        player.socketId = newPlayerId;
        
        // Restore original name and mark as reconnected
        if (player.originalName) {
            player.name = player.originalName;
            delete player.originalName;
        } else {
            player.name = playerName;
        }
        player.disconnected = false;
        
        // If game was paused (all players disconnected), resume if this is the first reconnection
        const activePlayers = this.gameState.players.filter(p => !p.disconnected);
        if (activePlayers.length > 0 && this.gameState.status === 'playing' && !this.turnExpiresAt) {
            // Game was paused, resume by starting timer for current player
            this.startTurnTimer();
        }
        
        return {
            success: true,
            playerIndex: playerIndex,
            playerName: player.name
        };
    }
    
    /**
     * Get full game state (for server use only)
     */
    getFullState() {
        return JSON.parse(JSON.stringify(this.gameState));
    }
}

