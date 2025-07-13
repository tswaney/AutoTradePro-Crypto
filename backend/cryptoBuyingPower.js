// backend/cryptoBuyingPower.js

require('dotenv').config();
const axios             = require('axios');
const { getAccessToken, PUBLIC_API_KEY } = require('./sessionManager');
const { signRequest }   = require('./signRequest');

// exactly the same constants and signing logic that your working smoke-test uses:
const TRADING_API = 'https://trading.robinhood.com';
const USER_AGENT  = 'Mozilla/5.0 PowerShell/7.2.0';

async function fetchCryptoBuyingPower() {
  const token     = await getAccessToken();
  const reqPath   = '/api/v1/crypto/billing/buying_power/';
  const url       = TRADING_API + reqPath;
  const timestamp = Math.floor(Date.now()/1000).toString();

  // this matches your liveTestBonk.js payload+signature
  const signature = signRequest(
    PUBLIC_API_KEY,
    timestamp,
    reqPath,
    'GET',
    {}
  );

  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent':  USER_AGENT,
    Accept:        'application/json',
    Origin:        'https://robinhood.com',
    'x-api-key':   PUBLIC_API_KEY,
    'x-timestamp': timestamp,
    'x-signature': signature
  };

  const resp = await axios.get(url, { headers, timeout: 10000 });
  return parseFloat(resp.data.crypto_buying_power);
}

module.exports = { fetchCryptoBuyingPower };
