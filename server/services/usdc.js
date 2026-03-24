const { ethers } = require('ethers');

const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS = 6;

// ERC-20 Transfer event ABI fragment
const TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * Verify a USDC transfer on Polygon.
 * Returns true if the tx sent at least `expectedUSD` USDC to the merchant wallet.
 */
async function verifyUSDCTransaction(txHash, expectedUSD) {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const merchantWallet = process.env.MERCHANT_USDC_WALLET;

  if (!rpcUrl) throw new Error('POLYGON_RPC_URL not configured');
  if (!merchantWallet) throw new Error('MERCHANT_USDC_WALLET not configured');

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return false;

    const iface = new ethers.Interface(TRANSFER_ABI);
    const contract = USDC_CONTRACT.toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contract) continue;

      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue;
      }

      if (parsed && parsed.name === 'Transfer') {
        const to = parsed.args.to.toLowerCase();
        if (to !== merchantWallet.toLowerCase()) continue;

        const value = parsed.args.value;
        const usdAmount = parseFloat(ethers.formatUnits(value, USDC_DECIMALS));

        // Accept if on-chain amount >= invoice total (allow minor rounding)
        if (usdAmount >= expectedUSD - 0.01) return true;
      }
    }

    return false;
  } catch (err) {
    console.error('USDC verification error:', err.message);
    return false;
  }
}

module.exports = { verifyUSDCTransaction };
