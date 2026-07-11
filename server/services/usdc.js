const { ethers } = require('ethers');

// USDC contracts per network
const NETWORKS = [
  {
    name: 'polygon',
    envKey: 'POLYGON_RPC_URL',
    contracts: [
      '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // native USDC
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // bridged USDC.e
    ],
    decimals: 6,
  },
  {
    name: 'ethereum',
    envKey: 'ETH_RPC_URL',
    contracts: [
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum mainnet
    ],
    decimals: 6,
  },
];

// ERC-20 Transfer event ABI fragment
const TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * Check one network for a valid USDC transfer to the merchant wallet.
 * Returns { found: true, blockTimestamp, amountUSD, from } or { found: false }.
 */
async function checkNetwork(network, txHash, expectedUSD, merchantWallet) {
  const rpcUrl = process.env[network.envKey];
  if (!rpcUrl) return { found: false };

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return { found: false };

    const iface = new ethers.Interface(TRANSFER_ABI);
    const contracts = network.contracts.map(c => c.toLowerCase());

    for (const log of receipt.logs) {
      if (!contracts.includes(log.address.toLowerCase())) continue;

      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue;
      }

      if (parsed && parsed.name === 'Transfer') {
        const to = parsed.args.to.toLowerCase();
        if (to !== merchantWallet.toLowerCase()) continue;

        const usdAmount = parseFloat(ethers.formatUnits(parsed.args.value, network.decimals));
        if (usdAmount >= expectedUSD - 0.01) {
          const block = await provider.getBlock(receipt.blockNumber);
          return {
            found: true,
            blockTimestamp: block ? new Date(Number(block.timestamp) * 1000) : null,
            amountUSD: usdAmount,
            from: parsed.args.from.toLowerCase(),
            blockNumber: receipt.blockNumber,
          };
        }
      }
    }

    return { found: false };
  } catch (err) {
    console.error(`USDC verification error on ${network.name}:`, err.message);
    return { found: false };
  }
}

/**
 * Verify a USDC transfer on Polygon (preferred) or Ethereum mainnet.
 * Returns { verified: true, network, blockTimestamp, amountUSD, from, blockNumber }
 *      or { verified: false }.
 */
async function verifyUSDCTransaction(txHash, expectedUSD) {
  const merchantWallet = process.env.MERCHANT_USDC_WALLET;
  if (!merchantWallet) throw new Error('MERCHANT_USDC_WALLET not configured');

  for (const network of NETWORKS) {
    const result = await checkNetwork(network, txHash, expectedUSD, merchantWallet);
    if (result.found) return { verified: true, network: network.name, ...result };
  }

  return { verified: false };
}

module.exports = { verifyUSDCTransaction };
