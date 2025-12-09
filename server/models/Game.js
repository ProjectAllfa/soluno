import { getDatabase } from '../db.js';

const COLLECTION_NAME = 'games';

/**
 * Game Model
 * 
 * Schema:
 * - _id: ObjectId (auto-generated)
 * - gameId: string (unique game identifier)
 * - lobbyId: string (lobby identifier)
 * - lobbyNumber: string (lobby number/name)
 * - players: Array of { username: string, wallet: string, playerIndex: number }
 * - gameMode: number (2, 3, or 4)
 * - solStake: number (SOL stake per player)
 * - totalStake: number (total SOL in escrow)
 * - status: string ('active', 'finished', 'cancelled')
 * - winner: { username: string, wallet: string, playerIndex: number } (null if not finished)
 * - startedAt: Date (game start time)
 * - endedAt: Date (game end time, null if not finished)
 * - winningsTxHash: string (transaction hash for winnings distribution, null if not distributed)
 * - feeTxHash: string (transaction hash for fee payment, null if not paid)
 * - createdAt: Date
 * - updatedAt: Date
 */

/**
 * Create a new game record
 * @param {Object} gameData - Game data
 * @returns {Promise<Object>} Created game document
 */
export async function createGame(gameData) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const game = {
        gameId: gameData.gameId,
        lobbyId: gameData.lobbyId,
        lobbyNumber: gameData.lobbyNumber,
        players: gameData.players,
        gameMode: gameData.gameMode,
        solStake: gameData.solStake,
        totalStake: gameData.totalStake,
        status: 'active',
        winner: null,
        startedAt: new Date(),
        endedAt: null,
        winningsTxHash: null,
        feeTxHash: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    const result = await collection.insertOne(game);
    
    // Return the created document
    return await collection.findOne({ _id: result.insertedId });
}

/**
 * Get game by gameId
 * @param {string} gameId - Game ID
 * @returns {Promise<Object|null>} Game document or null
 */
export async function getGameByGameId(gameId) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.findOne({ gameId: gameId });
}

/**
 * Update game when it ends
 * @param {string} gameId - Game ID
 * @param {Object} updateData - Update data
 * @param {Object} updateData.winner - Winner object { username: string, wallet: string, playerIndex: number }
 * @param {string} [updateData.winningsTxHash] - Winnings transaction hash
 * @param {string} [updateData.feeTxHash] - Fee transaction hash
 * @returns {Promise<Object|null>} Updated game document or null
 */
export async function updateGameOnEnd(gameId, updateData) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const update = {
        $set: {
            status: 'finished',
            winner: updateData.winner,
            endedAt: new Date(),
            updatedAt: new Date()
        }
    };
    
    if (updateData.winningsTxHash) {
        update.$set.winningsTxHash = updateData.winningsTxHash;
    }
    
    if (updateData.feeTxHash) {
        update.$set.feeTxHash = updateData.feeTxHash;
    }
    
    const result = await collection.findOneAndUpdate(
        { gameId: gameId },
        update,
        { returnDocument: 'after' }
    );
    
    return result;
}

/**
 * Update game with transaction hashes
 * @param {string} gameId - Game ID
 * @param {string} winningsTxHash - Winnings transaction hash
 * @param {string} feeTxHash - Fee transaction hash
 * @returns {Promise<Object|null>} Updated game document or null
 */
export async function updateGameTransactions(gameId, winningsTxHash, feeTxHash) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const update = {
        $set: {
            updatedAt: new Date()
        }
    };
    
    if (winningsTxHash) {
        update.$set.winningsTxHash = winningsTxHash;
    }
    
    if (feeTxHash) {
        update.$set.feeTxHash = feeTxHash;
    }
    
    const result = await collection.findOneAndUpdate(
        { gameId: gameId },
        update,
        { returnDocument: 'after' }
    );
    
    return result;
}

/**
 * Get games by wallet address
 * @param {string} wallet - User's wallet address
 * @param {number} limit - Number of games to return
 * @param {number} skip - Number of games to skip
 * @returns {Promise<Array>} Array of game documents
 */
export async function getGamesByWallet(wallet, limit = 50, skip = 0) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.find({
        'players.wallet': wallet
    })
    .sort({ startedAt: -1 })
    .limit(limit)
    .skip(skip)
    .toArray();
}

/**
 * Get games by status
 * @param {string} status - Game status ('active', 'finished', 'cancelled')
 * @param {number} limit - Number of games to return
 * @returns {Promise<Array>} Array of game documents
 */
export async function getGamesByStatus(status, limit = 100) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.find({ status: status })
        .sort({ startedAt: -1 })
        .limit(limit)
        .toArray();
}

