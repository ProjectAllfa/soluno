/**
 * Solana Wallet Connection Module
 * Handles wallet connection and user management
 */

import { getWalletBalance } from '../payment/paymentService.js';
import { getPfpUrl } from '../utils/pfpLoader.js';

let connectedWallet = null;
let currentUser = null;
let isAutoRestoring = false; // Track if we're auto-restoring connection
let cachedBalance = null; // Cache balance to avoid excessive API calls
let balanceCacheTime = 0;
let balanceRefreshInterval = null; // Interval for periodic balance refresh
const BALANCE_CACHE_TTL = 30000; // Cache balance for 30 seconds
const BALANCE_REFRESH_INTERVAL = 60000; // Refresh balance every 60 seconds

/**
 * Check if Solana wallet is available
 * @returns {boolean}
 */
function isWalletAvailable() {
    return window.solana && (window.solana.isPhantom || window.solana.isSolflare || window.solana.isBackpack);
}

/**
 * Initialize wallet connection
 */
export function initWallet() {
    // Wait for wallet to be available (in case extension loads after page)
    const checkWallet = () => {
        if (isWalletAvailable()) {
            // Check if wallet is already connected (from previous session)
            const savedWallet = localStorage.getItem('connectedWallet');
            if (savedWallet) {
                // Check if wallet is still connected
                if (window.solana.isConnected && window.solana.publicKey) {
                    const currentKey = window.solana.publicKey.toString();
                    if (currentKey === savedWallet) {
                        // Wallet is still connected, restore session (auto-restore)
                        isAutoRestoring = true;
                        connectWallet(savedWallet).then(() => {
                            isAutoRestoring = false;
                            // Give time for all modules to initialize before updating
                            setTimeout(() => {
                                updateWalletButton();
                            }, 500);
                        }).catch(() => {
                            isAutoRestoring = false;
                            handleWalletDisconnect();
                        });
                    } else {
                        // Different wallet connected
                        handleWalletDisconnect();
                    }
                } else {
                    // Try to restore connection silently (without showing modal)
                    // This happens on page load when wallet was previously connected
                    isAutoRestoring = true;
                    connectWallet(savedWallet).then((user) => {
                        isAutoRestoring = false;
                        if (user) {
                            // After successful auto-connect, ensure UI updates
                            // Give time for all modules to initialize
                            setTimeout(() => {
                                updateWalletButton();
                            }, 500);
                        }
                    }).catch(() => {
                        isAutoRestoring = false;
                        // If restore fails, clear saved state
                        handleWalletDisconnect();
                    });
                }
            }
            
            // Listen for wallet account changes
            window.solana.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    handleWalletDisconnect();
                    connectWallet(publicKey.toString());
                } else {
                    handleWalletDisconnect();
                }
            });
        } else {
            // Retry after a short delay if wallet not available yet
            setTimeout(checkWallet, 500);
        }
    };
    
    // Start checking
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkWallet);
    } else {
        checkWallet();
    }
}

/**
 * Connect to Solana wallet
 * @param {string} [publicKey] - Optional public key if already known
 * @returns {Promise<Object>} User object with wallet and username
 */
export async function connectWallet(publicKey = null) {
    try {
        // Check if Solana wallet is installed
        if (!isWalletAvailable()) {
            alert('Please install a Solana wallet extension (Phantom, Solflare, or Backpack) to connect your wallet.');
            return null;
        }
        
        // Connect to wallet if public key not provided
        if (!publicKey) {
            const response = await window.solana.connect();
            publicKey = response.publicKey.toString();
        }
        
        connectedWallet = publicKey;
        localStorage.setItem('connectedWallet', publicKey);
        
        // Get or create user from server
        const user = await fetchOrCreateUser(publicKey);
        currentUser = user;
        
        // Update UI
        await updateWalletButton();
        
        // Start periodic balance refresh
        startBalanceRefresh();
        
        // Always show username popup after connecting wallet
        // But only if this is a NEW connection (not auto-restore on page load)
        if (!isAutoRestoring) {
            // New connection, show modal
            showUsernameModal(user);
        }
        // For auto-restore, UI will update via the walletConnectionChanged event
        
        return user;
    } catch (error) {
        console.error('Error connecting wallet:', error);
        if (error.code === 4001) {
            // User rejected connection
            return null;
        }
        alert('Failed to connect wallet. Please try again.');
        return null;
    }
}

/**
 * Disconnect wallet
 */
export async function disconnectWallet() {
    try {
        if (window.solana && window.solana.isConnected) {
            await window.solana.disconnect();
        }
    } catch (error) {
        console.error('Error disconnecting wallet:', error);
    }
    
    handleWalletDisconnect();
}

/**
 * Handle wallet disconnect
 */
function handleWalletDisconnect() {
    connectedWallet = null;
    currentUser = null;
    localStorage.removeItem('connectedWallet');
    
    // Stop balance refresh
    stopBalanceRefresh();
    
    // Update UI immediately
    updateWalletButton();
    
    // Force update after a brief delay to ensure all listeners have processed
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('walletConnectionChanged', {
            detail: { connected: false, user: null }
        }));
    }, 100);
}

/**
 * Fetch or create user from server
 * @param {string} wallet - Wallet public key
 * @returns {Promise<Object>} User object
 */
async function fetchOrCreateUser(wallet) {
    try {
        const response = await fetch('/api/user/connect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ wallet })
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch/create user');
        }
        
        const user = await response.json();
        return user;
    } catch (error) {
        console.error('Error fetching/creating user:', error);
        // Return a default user object if server fails
        return {
            wallet,
            username: generateGuestUsername()
        };
    }
}

/**
 * Update username
 * @param {string} newUsername - New username
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUsername(newUsername) {
    if (!connectedWallet) {
        throw new Error('Wallet not connected');
    }
    
    try {
        const response = await fetch('/api/user/update-username', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                wallet: connectedWallet,
                username: newUsername
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update username');
        }
        
        const user = await response.json();
        currentUser = user;
        return user;
    } catch (error) {
        console.error('Error updating username:', error);
        throw error;
    }
}

/**
 * Generate guest username
 * @returns {string} Guest username
 */
function generateGuestUsername() {
    const randomNum = Math.floor(Math.random() * 10000);
    return `guest${randomNum}`;
}

/**
 * Get current connected wallet
 * @returns {string|null} Wallet public key
 */
export function getConnectedWallet() {
    return connectedWallet;
}

/**
 * Get current user
 * @returns {Object|null} User object
 */
export function getCurrentUser() {
    return currentUser;
}

/**
 * Check if wallet is connected
 * @returns {boolean}
 */
export function isWalletConnected() {
    return connectedWallet !== null;
}

/**
 * Get wallet balance (with caching)
 */
async function getCachedBalance() {
    const now = Date.now();
    // Return cached balance if still valid
    if (cachedBalance !== null && (now - balanceCacheTime) < BALANCE_CACHE_TTL) {
        return cachedBalance;
    }
    
    if (!connectedWallet) return null;
    
    try {
        const balance = await getWalletBalance(connectedWallet);
        cachedBalance = balance;
        balanceCacheTime = now;
        return balance;
    } catch (error) {
        console.error('Error fetching balance:', error);
        return cachedBalance; // Return cached value if fetch fails
    }
}

/**
 * Update wallet button UI
 */
async function updateWalletButton() {
    const walletBtn = document.getElementById('connectWalletBtn');
    if (!walletBtn) return;
    
    if (connectedWallet && currentUser) {
        // Get pfp URL
        const pfpUrl = getPfpUrl({ pfpUrl: currentUser.pfpUrl });
        
        // Get balance (async, but don't block UI update)
        const balance = await getCachedBalance();
        const balanceText = balance !== null ? ` (${balance.toFixed(2)} SOL)` : '';
        
        // Show username if available, otherwise show shortened wallet address
        const displayText = currentUser.username || `${connectedWallet.slice(0, 4)}...${connectedWallet.slice(-4)}`;
        
        // Update button with pfp and text
        walletBtn.innerHTML = `
            <img src="${pfpUrl}" alt="Profile" class="wallet-btn-pfp" onerror="this.src='/pfp/default.jpg'">
            <span class="wallet-btn-text">${escapeHtml(displayText)}${balanceText}</span>
        `;
        walletBtn.classList.add('wallet-connected');
    } else if (connectedWallet) {
        // Show shortened wallet address
        const shortAddress = `${connectedWallet.slice(0, 4)}...${connectedWallet.slice(-4)}`;
        const balance = await getCachedBalance();
        const balanceText = balance !== null ? ` (${balance.toFixed(2)} SOL)` : '';
        
        walletBtn.innerHTML = `
            <span class="wallet-btn-text">${shortAddress}${balanceText}</span>
        `;
        walletBtn.classList.add('wallet-connected');
    } else {
        walletBtn.innerHTML = '<span class="wallet-btn-text">Connect Wallet</span>';
        walletBtn.classList.remove('wallet-connected');
        cachedBalance = null; // Clear cache on disconnect
    }
    
    // Dispatch custom event for other modules to listen
    // Use a small delay to ensure all listeners are ready
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('walletConnectionChanged', {
            detail: { connected: connectedWallet !== null, user: currentUser }
        }));
    }, 50);
}

/**
 * Start periodic balance refresh
 */
function startBalanceRefresh() {
    // Clear existing interval if any
    stopBalanceRefresh();
    
    if (!connectedWallet) return;
    
    // Refresh balance periodically
    balanceRefreshInterval = setInterval(async () => {
        if (connectedWallet) {
            // Invalidate cache to force refresh
            balanceCacheTime = 0;
            await updateWalletButton();
        } else {
            stopBalanceRefresh();
        }
    }, BALANCE_REFRESH_INTERVAL);
}

/**
 * Stop periodic balance refresh
 */
function stopBalanceRefresh() {
    if (balanceRefreshInterval) {
        clearInterval(balanceRefreshInterval);
        balanceRefreshInterval = null;
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show username modal
 * @param {Object} user - User object
 */
function showUsernameModal(user) {
    const modal = document.getElementById('usernameModal');
    const usernameInput = document.getElementById('usernameInput');
    const walletDisplay = document.getElementById('walletDisplay');
    const saveBtn = document.getElementById('saveUsernameBtn');
    const errorMsg = document.getElementById('usernameError');
    const pfpPreview = document.getElementById('pfpPreview');
    const pfpInput = document.getElementById('pfpInput');
    const pfpError = document.getElementById('pfpError');
    const pfpUploadStatus = document.getElementById('pfpUploadStatus');
    
    if (!modal) return;
    
    // Store original username for comparison
    const originalUsername = (user.username || '').trim();
    
    // Set current values
    if (usernameInput) {
        usernameInput.value = originalUsername;
    }
    if (walletDisplay) {
        walletDisplay.textContent = `${user.wallet.slice(0, 8)}...${user.wallet.slice(-8)}`;
    }
    if (errorMsg) {
        errorMsg.textContent = '';
        errorMsg.style.display = 'none';
    }
    
    // Set current profile picture
    if (pfpPreview) {
        const pfpUrl = user.pfpUrl || '/pfp/default.jpg';
        pfpPreview.src = pfpUrl;
    }
    
    // Clear pfp error and status
    if (pfpError) {
        pfpError.textContent = '';
        pfpError.style.display = 'none';
    }
    if (pfpUploadStatus) {
        pfpUploadStatus.textContent = '';
        pfpUploadStatus.className = 'pfp-upload-status';
    }
    
    // Handle profile picture upload
    if (pfpInput) {
        pfpInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                if (pfpError) {
                    pfpError.textContent = 'Please select an image file';
                    pfpError.style.display = 'block';
                }
                return;
            }
            
            // Validate file size (2MB max)
            if (file.size > 2 * 1024 * 1024) {
                if (pfpError) {
                    pfpError.textContent = 'File size must be less than 2MB';
                    pfpError.style.display = 'block';
                }
                return;
            }
            
            // Clear previous errors
            if (pfpError) {
                pfpError.textContent = '';
                pfpError.style.display = 'none';
            }
            
            // Show preview immediately
            const reader = new FileReader();
            reader.onload = (e) => {
                if (pfpPreview) {
                    pfpPreview.src = e.target.result;
                }
            };
            reader.readAsDataURL(file);
            
            // Upload to server
            try {
                if (pfpUploadStatus) {
                    pfpUploadStatus.textContent = 'Uploading...';
                    pfpUploadStatus.className = 'pfp-upload-status uploading';
                }
                
                const formData = new FormData();
                formData.append('pfp', file);
                formData.append('wallet', user.wallet);
                
                const response = await fetch('/api/user/upload-pfp', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.error || 'Upload failed');
                }
                
                // Update preview with server URL
                if (pfpPreview && result.pfpUrl) {
                    pfpPreview.src = result.pfpUrl + '?t=' + Date.now(); // Cache bust
                }
                
                // Update current user
                if (currentUser) {
                    currentUser.pfpUrl = result.pfpUrl;
                }
                
                // Show success message
                if (pfpUploadStatus) {
                    pfpUploadStatus.textContent = 'Uploaded successfully!';
                    pfpUploadStatus.className = 'pfp-upload-status success';
                    setTimeout(() => {
                        pfpUploadStatus.textContent = '';
                        pfpUploadStatus.className = 'pfp-upload-status';
                    }, 2000);
                }
            } catch (error) {
                console.error('Error uploading profile picture:', error);
                if (pfpError) {
                    pfpError.textContent = error.message || 'Failed to upload profile picture';
                    pfpError.style.display = 'block';
                }
                if (pfpUploadStatus) {
                    pfpUploadStatus.textContent = '';
                    pfpUploadStatus.className = 'pfp-upload-status';
                }
                // Revert preview to original
                if (pfpPreview && currentUser) {
                    pfpPreview.src = (currentUser.pfpUrl || '/pfp/default.jpg') + '?t=' + Date.now();
                }
            }
        };
    }
    
    // Function to check if username has changed and update save button
    const updateSaveButtonState = () => {
        if (!saveBtn || !usernameInput) return;
        
        const currentValue = usernameInput.value.trim();
        const hasChanged = currentValue !== originalUsername;
        const isValid = currentValue.length >= 3 && currentValue.length <= 20;
        
        // Enable save button only if username has changed AND is valid
        saveBtn.disabled = !hasChanged || !isValid;
    };
    
    // Initially disable save button (no changes yet)
    updateSaveButtonState();
    
    // Listen to input events to update save button state
    if (usernameInput) {
        usernameInput.addEventListener('input', updateSaveButtonState);
        usernameInput.addEventListener('paste', () => {
            // Small delay to let paste complete
            setTimeout(updateSaveButtonState, 10);
        });
    }
    
    // Show modal
    modal.style.display = 'block';
    
    // Focus on username input
    if (usernameInput) {
        setTimeout(() => usernameInput.focus(), 100);
    }
    
    // Handle save function
    const handleSave = async () => {
        // Don't save if button is disabled
        if (saveBtn.disabled) return;
        
        const newUsername = usernameInput.value.trim();
        
        // Double-check validation (should already be validated by button state, but just in case)
        if (!newUsername) {
            if (errorMsg) {
                errorMsg.textContent = 'Username cannot be empty';
                errorMsg.style.display = 'block';
            }
            updateSaveButtonState();
            return;
        }
        
        if (newUsername.length < 3) {
            if (errorMsg) {
                errorMsg.textContent = 'Username must be at least 3 characters';
                errorMsg.style.display = 'block';
            }
            updateSaveButtonState();
            return;
        }
        
        if (newUsername.length > 20) {
            if (errorMsg) {
                errorMsg.textContent = 'Username must be less than 20 characters';
                errorMsg.style.display = 'block';
            }
            updateSaveButtonState();
            return;
        }
        
        // Check if username actually changed
        if (newUsername === originalUsername) {
            // No change, just close modal
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleKeyPress);
            if (usernameInput) {
                usernameInput.removeEventListener('input', updateSaveButtonState);
                usernameInput.removeEventListener('paste', updateSaveButtonState);
            }
            return;
        }
        
        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            
            const updatedUser = await updateUsername(newUsername);
            currentUser = updatedUser;
            
            // Close modal
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleKeyPress);
            if (usernameInput) {
                usernameInput.removeEventListener('input', updateSaveButtonState);
                usernameInput.removeEventListener('paste', updateSaveButtonState);
            }
            
            // Update button text with new username
            updateWalletButton();
        } catch (error) {
            if (errorMsg) {
                errorMsg.textContent = error.message || 'Failed to update username';
                errorMsg.style.display = 'block';
            }
            saveBtn.textContent = 'Save';
            // Re-enable button state checking
            updateSaveButtonState();
        }
    };
    
    // Handle Enter key to save and Escape to close
    const handleKeyPress = async (e) => {
        if (e.key === 'Enter' && !saveBtn.disabled) {
            e.preventDefault();
            await handleSave();
        } else if (e.key === 'Escape') {
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleKeyPress);
            if (usernameInput) {
                usernameInput.removeEventListener('input', updateSaveButtonState);
                usernameInput.removeEventListener('paste', updateSaveButtonState);
            }
        }
    };
    document.addEventListener('keydown', handleKeyPress);
    
    // Handle save button
    if (saveBtn) {
        saveBtn.onclick = handleSave;
    }
    
    // Handle disconnect button
    const disconnectBtn = document.getElementById('disconnectWalletBtn');
    if (disconnectBtn) {
        disconnectBtn.onclick = async () => {
            // Disconnect wallet
            await disconnectWallet();
            // Close modal
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleKeyPress);
            if (usernameInput) {
                usernameInput.removeEventListener('input', updateSaveButtonState);
                usernameInput.removeEventListener('paste', updateSaveButtonState);
            }
        };
    }
}

/**
 * Show username modal (public function)
 */
export function showUsernameModalPublic() {
    if (currentUser) {
        showUsernameModal(currentUser);
    }
}

