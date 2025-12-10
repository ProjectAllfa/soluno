/**
 * Client-side Payment Service
 * Handles Solana payment transactions for joining lobbies
 * Uses Solana web3.js from CDN (ESM)
 */

// Import Solana web3.js from CDN as ES module
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from 'https://esm.sh/@solana/web3.js@1.87.6';

// Solana connection - RPC URL fetched from server
let cachedRpcUrl = null;

/**
 * Get RPC URL from server
 */
async function getRpcUrl() {
    if (cachedRpcUrl) {
        return cachedRpcUrl;
    }
    
    try {
        const response = await fetch('/api/config/rpc-url');
        if (!response.ok) {
            throw new Error('Failed to get RPC URL from server');
        }
        const data = await response.json();
        cachedRpcUrl = data.rpcUrl;
        return cachedRpcUrl;
    } catch (error) {
        throw new Error('Failed to get RPC URL. Please refresh the page.');
    }
}

const getConnection = async () => {
    // Get RPC URL from server (Helius RPC with API key)
    const rpcUrl = await getRpcUrl();
    
    // Allow override with window.SOLANA_RPC_URL if needed (for development/testing)
    const finalRpcUrl = window.SOLANA_RPC_URL || rpcUrl;
    
    return new Connection(finalRpcUrl, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
    });
};

/**
 * Convert SOL to lamports
 */
function solToLamports(sol) {
    return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Request payment info from server
 * @param {string} wallet - User's wallet address
 * @param {string} lobbyId - Lobby ID
 * @returns {Promise<Object>} Payment info with escrow wallet and amount
 */
export async function requestPaymentInfo(wallet, lobbyId) {
    try {
        const response = await fetch('/api/payment/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ wallet, lobbyId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to request payment info');
        }

        return await response.json();
    } catch (error) {
        throw error;
    }
}

/**
 * Get wallet balance
 * @param {string} walletAddress - Wallet public key
 * @returns {Promise<number>} Balance in SOL
 */
export async function getWalletBalance(walletAddress) {
    try {
        const connection = await getConnection();
        const publicKey = new PublicKey(walletAddress);
        const balance = await connection.getBalance(publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        // If RPC is rate limited, return null to indicate we couldn't check
        if (error.message && error.message.includes('403')) {
            return null;
        }
        return 0;
    }
}

/**
 * Create and sign payment transaction
 * @param {string} userWallet - User's wallet public key
 * @param {string} escrowWallet - Escrow wallet public key
 * @param {number} solAmount - Amount in SOL
 * @returns {Promise<string>} Transaction signature
 */
export async function createAndSignPayment(userWallet, escrowWallet, solAmount) {
    try {
        // Check if wallet is available
        if (!window.solana) {
            throw new Error('Solana wallet not found. Please install Phantom or another Solana wallet.');
        }
        
        if (!window.solana.isConnected) {
            throw new Error('Wallet not connected. Please connect your wallet.');
        }

        // Verify the connected wallet matches the user wallet
        const connectedPublicKey = window.solana.publicKey;
        if (!connectedPublicKey) {
            throw new Error('Wallet not connected. Please connect your wallet.');
        }
        
        // Use the connected wallet's public key (more reliable)
        const actualUserWallet = connectedPublicKey.toString();
        
        if (actualUserWallet !== userWallet) {
            // Wallet mismatch - use connected wallet
        }

        const userPublicKey = connectedPublicKey; // Use the actual connected wallet
        const escrowPublicKey = new PublicKey(escrowWallet);

        // Get connection
        const connection = await getConnection();
        
        // Check user's balance before creating transaction (with retry on 403)
        let userBalance;
        try {
            userBalance = await connection.getBalance(userPublicKey);
        } catch (error) {
            // If balance check fails (e.g., 403 rate limit), skip balance check
            // The transaction will fail later if there's insufficient balance anyway
            userBalance = Number.MAX_SAFE_INTEGER; // Skip balance check
        }
        
        const requiredLamports = solToLamports(solAmount);
        const estimatedFee = 5000; // Estimated transaction fee in lamports
        
        if (userBalance < requiredLamports + estimatedFee) {
            const balanceSOL = userBalance / LAMPORTS_PER_SOL;
            throw new Error(`Insufficient balance. You have ${balanceSOL.toFixed(4)} SOL, but need ${solAmount.toFixed(4)} SOL + transaction fee.`);
        }

        // Create transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: userPublicKey,
                toPubkey: escrowPublicKey,
                lamports: requiredLamports,
            })
        );

        // Get blockhash from Helius RPC
        let blockhash, lastValidBlockHeight;
        try {
            const result = await connection.getLatestBlockhash('finalized');
            blockhash = result.blockhash;
            lastValidBlockHeight = result.lastValidBlockHeight;
            transaction.recentBlockhash = blockhash;
        } catch (error) {
            throw new Error('Unable to connect to Solana network. Please check your internet connection or try again later.');
        }
        
        transaction.feePayer = userPublicKey;

        // Phantom and most wallets use signTransaction (not signAndSendTransaction)
        // signAndSendTransaction is less common
        let signature;
        
        if (window.solana.signTransaction) {
            // Standard method - sign then send separately
            let signedTransaction;
            try {
                signedTransaction = await window.solana.signTransaction(transaction);
            } catch (error) {
                if (error.code === 4001 || error.message?.includes('User rejected') || error.message?.includes('User cancelled') || error.message?.includes('cancel')) {
                    throw new Error('Transaction cancelled by user');
                }
                throw error;
            }

            // Send transaction
            try {
                signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
                    skipPreflight: true,
                    maxRetries: 3
                });
            } catch (error) {
                throw new Error(`Failed to send transaction: ${error.message}`);
            }
        } else if (window.solana.signAndSendTransaction) {
            // Alternative method if available
            try {
                const result = await window.solana.signAndSendTransaction(transaction);
                signature = result.signature;
            } catch (error) {
                if (error.code === 4001 || error.message?.includes('User rejected') || error.message?.includes('User cancelled')) {
                    throw new Error('Transaction cancelled by user');
                }
                throw error;
            }
        } else {
            throw new Error('Wallet does not support transaction signing. Please use a compatible wallet like Phantom or Solflare.');
        }

        // Check transaction status (using polling instead of WebSocket subscription)
        // The transaction is already sent, we just want to verify it was successful
        try {
            // Poll for transaction status (avoid WebSocket issues in browser)
            let confirmed = false;
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                
                const txStatus = await connection.getSignatureStatus(signature);
                
                if (txStatus.value) {
                    if (txStatus.value.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(txStatus.value.err)}`);
                    }
                    if (txStatus.value.confirmationStatus === 'confirmed' || txStatus.value.confirmationStatus === 'finalized') {
                        confirmed = true;
                        break;
                    }
                }
            }
        } catch (error) {
            // If status check fails, transaction might still be processing
            // This is okay - the transaction was sent and the wallet confirmed it
        }

        return signature;
    } catch (error) {
        // Provide user-friendly error messages
        if (error.message.includes('Insufficient balance')) {
            throw error;
        } else if (error.message.includes('User rejected')) {
            throw new Error('Transaction cancelled by user');
        } else if (error.message.includes('failed to send transaction')) {
            throw new Error('Transaction failed. Please check your wallet balance and try again.');
        } else {
            throw new Error(error.message || 'Failed to process payment');
        }
    }
}

/**
 * Verify payment with server
 * @param {string} signature - Transaction signature
 * @param {string} wallet - User's wallet address
 * @param {string} lobbyId - Lobby ID
 * @returns {Promise<Object>} Verification result
 */
export async function verifyPayment(signature, wallet, lobbyId) {
    try {
        const response = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ signature, wallet, lobbyId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Payment verification failed');
        }

        return await response.json();
    } catch (error) {
        throw error;
    }
}

/**
 * Complete payment flow: request info, create transaction, sign, and verify
 * @param {string} wallet - User's wallet address
 * @param {string} lobbyId - Lobby ID
 * @returns {Promise<string>} Payment signature
 */
export async function processPayment(wallet, lobbyId) {
    try {
        // Step 1: Request payment info
        const paymentInfo = await requestPaymentInfo(wallet, lobbyId);
        
        if (!paymentInfo.escrowWallet || !paymentInfo.solAmount) {
            throw new Error('Invalid payment info received');
        }

        // Step 2: Create and sign transaction
        const signature = await createAndSignPayment(
            wallet,
            paymentInfo.escrowWallet,
            paymentInfo.solAmount
        );

        // Step 3: Verify payment with server
        const verification = await verifyPayment(signature, wallet, lobbyId);

        if (!verification.success) {
            throw new Error('Payment verification failed');
        }

        return signature;
    } catch (error) {
        throw error;
    }
}

