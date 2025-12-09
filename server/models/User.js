import { getDatabase } from '../db.js';

const COLLECTION_NAME = 'users';

/**
 * User Model
 * 
 * Schema:
 * - _id: ObjectId (auto-generated)
 * - username: string (unique)
 * - wallet: string (unique, public wallet address)
 * - pfpUrl: string (profile picture URL, e.g., "/pfp/{userId}.webp")
 * - createdAt: Date
 * - updatedAt: Date
 */

/**
 * Create or update a user
 * @param {string} username - User's username
 * @param {string} wallet - User's public wallet address
 * @returns {Promise<Object>} User document
 */
export async function createOrUpdateUser(username, wallet) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const user = {
        username,
        wallet,
        updatedAt: new Date()
    };
    
    // Use wallet as unique identifier
    const result = await collection.findOneAndUpdate(
        { wallet: wallet },
        {
            $set: user,
            $setOnInsert: { createdAt: new Date() }
        },
        {
            upsert: true,
            returnDocument: 'after'
        }
    );
    
    return result;
}

/**
 * Get user by wallet address
 * @param {string} wallet - User's public wallet address
 * @returns {Promise<Object|null>} User document or null
 */
export async function getUserByWallet(wallet) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.findOne({ wallet: wallet });
}

/**
 * Get user by username
 * @param {string} username - User's username
 * @returns {Promise<Object|null>} User document or null
 */
export async function getUserByUsername(username) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.findOne({ username: username });
}

/**
 * Update user's username
 * @param {string} wallet - User's public wallet address
 * @param {string} newUsername - New username
 * @returns {Promise<Object|null>} Updated user document or null
 */
export async function updateUsername(wallet, newUsername) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const result = await collection.findOneAndUpdate(
        { wallet: wallet },
        {
            $set: {
                username: newUsername,
                updatedAt: new Date()
            }
        },
        { returnDocument: 'after' }
    );
    
    return result;
}

/**
 * Update user's profile picture URL
 * @param {string} wallet - User's public wallet address
 * @param {string} pfpUrl - Profile picture URL (e.g., "/pfp/{userId}.webp")
 * @returns {Promise<Object|null>} Updated user document or null
 */
export async function updatePfp(wallet, pfpUrl) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const result = await collection.findOneAndUpdate(
        { wallet: wallet },
        {
            $set: {
                pfpUrl: pfpUrl,
                updatedAt: new Date()
            }
        },
        { returnDocument: 'after' }
    );
    
    return result;
}

/**
 * Get all users (for admin purposes, paginated)
 * @param {number} limit - Number of users to return
 * @param {number} skip - Number of users to skip
 * @returns {Promise<Array>} Array of user documents
 */
export async function getAllUsers(limit = 100, skip = 0) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();
}

