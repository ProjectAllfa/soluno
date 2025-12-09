import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get and clean the MongoDB URI (remove quotes if present)
let MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

// Remove surrounding quotes if present
MONGODB_URI = MONGODB_URI.replace(/^["']|["']$/g, '');

// Connection options for MongoDB Atlas
const options = {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
};

let client;
let clientPromise;

if (process.env.NODE_ENV === 'development') {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR (Hot Module Replacement).
    if (!global._mongoClientPromise) {
        client = new MongoClient(MONGODB_URI, options);
        global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
} else {
    // In production mode, it's best to not use a global variable.
    client = new MongoClient(MONGODB_URI, options);
    clientPromise = client.connect();
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise;

/**
 * Get database instance
 * @param {string} dbName - Database name (default: 'uno')
 * @returns {Promise<Db>} Database instance
 */
export async function getDatabase(dbName = 'uno') {
    const client = await clientPromise;
    return client.db(dbName);
}

/**
 * Test database connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
    try {
        const client = await clientPromise;
        await client.db('admin').command({ ping: 1 });
        console.log('✅ Successfully connected to MongoDB Atlas');
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        return false;
    }
}

