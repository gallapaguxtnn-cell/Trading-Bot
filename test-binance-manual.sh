#!/bin/bash

# ===== CREDENCIAIS =====
API_KEY="ba5eYD33BkvQrPihTO7wuHlwMN8Efmo3i2kdjoVoen7Rzdy24SHWEeAUBaJV34HK"
API_SECRET="h4WHRlFIMF7QSmhbzKVXmynUQQfTjL6ZzaJU1ZrcSrz5wfxMwQjzzi6lbAlOtRb9"

# ===== PROXY =====
PROXY_HOST="212.68.183.134"
PROXY_USER="gallapaguxtnn"
PROXY_PASS="zBlDja6345"
PROXY_PORT="59100"

# ===== TESTNET BINANCE =====
BASE_URL="https://testnet.binancefuture.com"

echo "=================================================="
echo "🔍 TESTE 1: BALANCE (deve funcionar - código 200)"
echo "=================================================="
TIMESTAMP=$(date +%s000)
QUERY="timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$QUERY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 Request: GET $BASE_URL/fapi/v2/balance"
echo "🔑 API Key: ${API_KEY:0:20}..."
echo "⏰ Timestamp: $TIMESTAMP"
echo "✍️  Signature: ${SIGNATURE:0:20}..."
echo ""

curl -v -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -H "X-MBX-APIKEY: $API_KEY" \
  "$BASE_URL/fapi/v2/balance?$QUERY&signature=$SIGNATURE" 2>&1 | head -100

echo -e "\n\n"

echo "=================================================="
echo "🔍 TESTE 2: CRIAR ORDEM (vai dar erro -2015?)"
echo "=================================================="
TIMESTAMP=$(date +%s000)
BODY="symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=0.001&price=50000&timeInForce=GTC&timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 Request: POST $BASE_URL/fapi/v1/order"
echo "🔑 API Key: ${API_KEY:0:20}..."
echo "⏰ Timestamp: $TIMESTAMP"
echo "📦 Body: $BODY"
echo "✍️  Signature: ${SIGNATURE:0:20}..."
echo ""

curl -v -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -X POST \
  -H "X-MBX-APIKEY: $API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "$BODY&signature=$SIGNATURE" \
  "$BASE_URL/fapi/v1/order" 2>&1

echo -e "\n\n"
echo "✅ TESTES CONCLUÍDOS"
