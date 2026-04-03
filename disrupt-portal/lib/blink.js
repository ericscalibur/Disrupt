"use strict";

const axios = require("axios");
const logger = require("../logger");

const BLINK_API_KEY = process.env.BLINK_API_KEY;
const BLINK_TIMEOUT_MS = 30_000;

function blinkPost(data) {
  return axios.post("https://api.blink.sv/graphql", data, {
    headers: { "Content-Type": "application/json", "X-API-KEY": BLINK_API_KEY },
    timeout: BLINK_TIMEOUT_MS,
  });
}

async function getBlinkWallets() {
  const query = `
    query {
      me {
        defaultAccount {
          wallets {
            id
            walletCurrency
            balance
          }
        }
      }
    }
  `;
  const response = await blinkPost({ query });
  return response.data.data.me.defaultAccount.wallets;
}

async function fetchPreImageFromBlink(paymentHash) {
  if (!paymentHash || !BLINK_API_KEY) return null;
  try {
    const query = `
      query {
        me {
          defaultAccount {
            transactions(first: 10) {
              edges {
                node {
                  initiationVia {
                    ... on InitiationViaLn {
                      paymentHash
                    }
                  }
                  settlementVia {
                    ... on SettlementViaIntraLedger {
                      preImage
                    }
                    ... on SettlementViaLn {
                      preImage
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const response = await blinkPost({ query });
    const edges = response.data.data.me.defaultAccount.transactions.edges;
    const match = edges.find(
      (edge) => edge.node.initiationVia?.paymentHash === paymentHash,
    );
    return match?.node?.settlementVia?.preImage || null;
  } catch (err) {
    logger.warn("Could not fetch preImage from Blink:", err.message);
    return null;
  }
}

async function getBlinkTransactions() {
  const query = `
    query {
      me {
        defaultAccount {
          transactions(first: 50) {
            edges {
              node {
                id
                initiationVia { __typename }
                settlementAmount
                settlementCurrency
                createdAt
                status
                direction
                memo
              }
            }
          }
        }
      }
    }
  `;
  const response = await blinkPost({ query });
  return response.data.data.me.defaultAccount.transactions.edges.map(
    (edge) => edge.node,
  );
}

// Fetch current BTC/USD rate from Blink API — returns a number or null
async function getBtcUsdRate() {
  try {
    // Blink removed btcPrice; the current API uses realtimePrice.
    // btcSatPrice.base / 10^offset = price of 1 sat in USD cents
    // BTC/USD = (sat_price_in_usd_cents * 100_000_000 sats/BTC) / 100 cents/dollar
    const response = await blinkPost({
      query: "query { realtimePrice { btcSatPrice { base offset } } }",
    });
    const result = response.data;
    const btcSatPrice =
      result.data &&
      result.data.realtimePrice &&
      result.data.realtimePrice.btcSatPrice;
    if (
      btcSatPrice &&
      typeof btcSatPrice.base === "number" &&
      typeof btcSatPrice.offset === "number"
    ) {
      const { base, offset } = btcSatPrice;
      // base / 10^offset  →  USD cents per sat
      // × 100_000_000 sats/BTC  ÷ 100 cents/dollar  →  USD per BTC
      const usdPerSat = base / Math.pow(10, offset);
      return (usdPerSat * 100_000_000) / 100;
    }
    logger.warn(
      "getBtcUsdRate: unexpected Blink response",
      JSON.stringify(result),
    );
    return null;
  } catch (err) {
    logger.warn("Could not fetch BTC/USD rate from Blink:", err.message);
    return null;
  }
}

module.exports = {
  blinkPost,
  getBlinkWallets,
  fetchPreImageFromBlink,
  getBlinkTransactions,
  getBtcUsdRate,
};
