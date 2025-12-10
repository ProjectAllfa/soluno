/**
 * Profile Picture Loader and Cache
 * Handles loading and caching of profile pictures for use in canvas and DOM
 */

// In-memory cache for loaded images
const avatarImages = new Map();

// Default pfp path
const DEFAULT_PFP = '/pfp/default.jpg';

/**
 * Get pfp URL for a user, with fallback to default
 * @param {Object} user - User object with pfpUrl property
 * @returns {string} PFP URL
 */
export function getPfpUrl(user) {
    if (!user) return DEFAULT_PFP;
    return user.pfpUrl || DEFAULT_PFP;
}

/**
 * Load a profile picture and cache it
 * @param {string} pfpUrl - Profile picture URL
 * @param {string} userId - User ID for caching
 * @returns {Promise<Image>} Loaded image object
 */
export function loadPfp(pfpUrl, userId) {
    // Return cached image if available
    if (avatarImages.has(userId)) {
        return Promise.resolve(avatarImages.get(userId));
    }
    
    // Use default if no URL provided
    const url = pfpUrl || DEFAULT_PFP;
    
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            // Cache the loaded image
            avatarImages.set(userId, img);
            resolve(img);
        };
        
        img.onerror = () => {
            // If loading fails, try default
            if (url !== DEFAULT_PFP) {
                const defaultImg = new Image();
                defaultImg.onload = () => {
                    avatarImages.set(userId, defaultImg);
                    resolve(defaultImg);
                };
                defaultImg.onerror = () => {
                    reject(new Error('Failed to load profile picture'));
                };
                defaultImg.src = DEFAULT_PFP;
            } else {
                reject(new Error('Failed to load profile picture'));
            }
        };
        
        // Add cache busting if needed (for updates)
        img.src = url;
    });
}

/**
 * Load profile pictures for multiple users
 * @param {Array<Object>} users - Array of user objects with pfpUrl and id/wallet
 * @param {string} idField - Field to use as ID (default: 'id', can be 'wallet')
 * @returns {Promise<Map<string, Image>>} Map of userId -> Image
 */
export async function loadPfpsForUsers(users, idField = 'id') {
    const loadPromises = users.map(user => {
        const userId = user[idField] || user.wallet || user._id;
        const pfpUrl = getPfpUrl(user);
        return loadPfp(pfpUrl, userId).catch(() => {
            // Return null for failed loads, will use default later
            return null;
        });
    });
    
    const images = await Promise.all(loadPromises);
    const result = new Map();
    
    users.forEach((user, index) => {
        const userId = user[idField] || user.wallet || user._id;
        const img = images[index];
        if (img) {
            result.set(userId, img);
        }
    });
    
    return result;
}

/**
 * Get cached image for a user
 * @param {string} userId - User ID
 * @returns {Image|null} Cached image or null
 */
export function getCachedPfp(userId) {
    return avatarImages.get(userId) || null;
}

/**
 * Draw a circular profile picture on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Image|string} imgOrUrl - Image object or URL string
 * @param {number} x - X position (center)
 * @param {number} y - Y position (center)
 * @param {number} radius - Radius of the circle
 * @param {string} userId - Optional user ID for caching if imgOrUrl is a URL
 */
export async function drawCircularPfp(ctx, imgOrUrl, x, y, radius, userId = null) {
    let img = imgOrUrl;
    
    // If it's a URL string, try to load it
    if (typeof imgOrUrl === 'string') {
        if (userId && avatarImages.has(userId)) {
            img = avatarImages.get(userId);
        } else {
            try {
                img = await loadPfp(imgOrUrl, userId);
            } catch (error) {
                // Fallback to default
                img = await loadPfp(DEFAULT_PFP, 'default');
            }
        }
    }
    
    if (!img || !(img instanceof Image)) {
        return; // Can't draw if no valid image
    }
    
    // Save context state
    ctx.save();
    
    // Create circular clipping path
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    
    // Draw image
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
    
    // Restore context state
    ctx.restore();
}

/**
 * Draw a rectangular profile picture on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Image|string} imgOrUrl - Image object or URL string
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Width
 * @param {number} height - Height
 * @param {string} userId - Optional user ID for caching if imgOrUrl is a URL
 */
export async function drawRectPfp(ctx, imgOrUrl, x, y, width, height, userId = null) {
    let img = imgOrUrl;
    
    // If it's a URL string, try to load it
    if (typeof imgOrUrl === 'string') {
        if (userId && avatarImages.has(userId)) {
            img = avatarImages.get(userId);
        } else {
            try {
                img = await loadPfp(imgOrUrl, userId);
            } catch (error) {
                // Fallback to default
                img = await loadPfp(DEFAULT_PFP, 'default');
            }
        }
    }
    
    if (!img || !(img instanceof Image)) {
        return; // Can't draw if no valid image
    }
    
    ctx.drawImage(img, x, y, width, height);
}

/**
 * Clear the cache (useful for memory management)
 */
export function clearPfpCache() {
    avatarImages.clear();
}

/**
 * Remove a specific user's image from cache
 * @param {string} userId - User ID
 */
export function removeFromCache(userId) {
    avatarImages.delete(userId);
}

/**
 * Preload profile pictures for players in a lobby/game
 * This should be called after receiving player info, not during initialization
 * @param {Array<Object>} players - Array of player objects
 * @param {string} idField - Field to use as ID (default: 'id')
 */
export async function preloadPlayerPfps(players, idField = 'id') {
    if (!players || players.length === 0) return;
    
    const users = players.map(player => ({
        id: player[idField] || player.wallet || player._id,
        wallet: player.wallet,
        pfpUrl: player.pfpUrl
    }));
    
    try {
        await loadPfpsForUsers(users, 'id');
    } catch (error) {
        // Error preloading player profile pictures
    }
}

