#!/bin/bash

# Test script for Bybit API authentication
# This will help diagnose if the issue is with credentials or code

echo "=== Bybit API Authentication Test ==="
echo ""

# You need to set these environment variables or replace them directly
API_KEY="${BYBIT_API_KEY}"
API_SECRET="${BYBIT_API_SECRET}"

if [ -z "$API_KEY" ] || [ -z "$API_SECRET" ]; then
    echo "ERROR: Please set BYBIT_API_KEY and BYBIT_API_SECRET environment variables"
    echo "Example: export BYBIT_API_KEY='your_key_here'"
    echo "         export BYBIT_API_SECRET='your_secret_here'"
    exit 1
fi

# Configuration
BASE_URL="https://api.bybit.com"
RECV_WINDOW="5000"

echo "Testing with API Key: ${API_KEY:0:8}..."
echo ""

# Test 1: Public endpoint (no auth needed)
echo "=== TEST 1: Public Endpoint (Server Time) ==="
RESPONSE=$(curl -s "${BASE_URL}/v5/market/time")
echo "Response: $RESPONSE"
echo ""

# Test 2: Wallet Balance with UNIFIED account type
echo "=== TEST 2: Wallet Balance (UNIFIED) with Authentication ==="

# Generate timestamp (milliseconds)
TIMESTAMP=$(date +%s%3N)

# Query parameters
QUERY_STRING="accountType=UNIFIED"

# Generate signature: timestamp + apiKey + recvWindow + queryString
PRE_SIGN="${TIMESTAMP}${API_KEY}${RECV_WINDOW}${QUERY_STRING}"
SIGNATURE=$(echo -n "$PRE_SIGN" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "Timestamp: $TIMESTAMP"
echo "PreSign String: ${PRE_SIGN:0:50}..."
echo "Signature: ${SIGNATURE:0:16}..."
echo ""

# Make the request
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -H "X-BAPI-API-KEY: $API_KEY" \
    -H "X-BAPI-TIMESTAMP: $TIMESTAMP" \
    -H "X-BAPI-SIGN: $SIGNATURE" \
    -H "X-BAPI-RECV-WINDOW: $RECV_WINDOW" \
    -H "Content-Type: application/json" \
    "${BASE_URL}/v5/account/wallet-balance?${QUERY_STRING}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")

echo "HTTP Status Code: $HTTP_CODE"
echo "Response Body: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Test 3: Wallet Balance with CONTRACT account type (fallback)
if [ "$HTTP_CODE" != "200" ]; then
    echo "=== TEST 3: Wallet Balance (CONTRACT) - Fallback ==="

    TIMESTAMP=$(date +%s%3N)
    QUERY_STRING="accountType=CONTRACT"
    PRE_SIGN="${TIMESTAMP}${API_KEY}${RECV_WINDOW}${QUERY_STRING}"
    SIGNATURE=$(echo -n "$PRE_SIGN" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

    RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
        -H "X-BAPI-API-KEY: $API_KEY" \
        -H "X-BAPI-TIMESTAMP: $TIMESTAMP" \
        -H "X-BAPI-SIGN: $SIGNATURE" \
        -H "X-BAPI-RECV-WINDOW: $RECV_WINDOW" \
        -H "Content-Type: application/json" \
        "${BASE_URL}/v5/account/wallet-balance?${QUERY_STRING}")

    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")

    echo "HTTP Status Code: $HTTP_CODE"
    echo "Response Body: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
    echo ""
fi

echo "=== Test Complete ==="
echo ""
echo "If you see retCode=0, authentication is working!"
echo "If you see retCode=10003 or 10005, it's a permission issue."
echo "If you see retCode=10004, it's a signature/timestamp issue."
