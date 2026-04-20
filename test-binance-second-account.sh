#!/bin/bash

# ===== SEGUNDA CONTA - TEST REAL NOVO =====
API_KEY="4DpEDgeOIgWI5sVYMWGiFgoBpq6ZpfcG2K2TrqkRrVy2Yjbo7t66pUbxS1iEeSpO"
API_SECRET="3tF8bdq5rdYHvzmpYKoBjzqDaIXz25tu1b25c5cYGSBtgYtgQ1P7iIhjydaS4mPX"

# ===== PROXY =====
PROXY_HOST="212.68.183.134"
PROXY_USER="gallapaguxtnn"
PROXY_PASS="zBIDja6345"
PROXY_PORT="59100"

# ===== BINANCE REAL (NÃO TESTNET) =====
BASE_URL="https://fapi.binance.com"

echo "=========================================================="
echo "🔍 DIAGNÓSTICO SEGUNDA CONTA - TEST REAL NOVO <BINANCE>"
echo "=========================================================="
echo "🔑 API Key: ${API_KEY:0:30}..."
echo "🌐 URL Base: $BASE_URL (CONTA REAL)"
echo ""

echo "=========================================================="
echo "TESTE 1: BALANCE - Verificar autenticação básica"
echo "=========================================================="
TIMESTAMP=$(date +%s000)
QUERY="timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$QUERY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 GET $BASE_URL/fapi/v2/balance"
echo "⏰ Timestamp: $TIMESTAMP"
echo ""

RESPONSE=$(curl -s -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -H "X-MBX-APIKEY: $API_KEY" \
  "$BASE_URL/fapi/v2/balance?$QUERY&signature=$SIGNATURE")

echo "📥 Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Check for error
if echo "$RESPONSE" | grep -q '"code"'; then
    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null)
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.msg' 2>/dev/null)
    echo "❌ ERRO: Code $ERROR_CODE - $ERROR_MSG"
    echo ""
fi

echo "=========================================================="
echo "TESTE 2: ACCOUNT INFO - Verificar positionSide config"
echo "=========================================================="
TIMESTAMP=$(date +%s000)
QUERY="timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$QUERY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 GET $BASE_URL/fapi/v2/account"
echo ""

RESPONSE=$(curl -s -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -H "X-MBX-APIKEY: $API_KEY" \
  "$BASE_URL/fapi/v2/account?$QUERY&signature=$SIGNATURE")

echo "📥 Response (positionSide config):"
echo "$RESPONSE" | jq '.positions[0].positionSide' 2>/dev/null || echo "$RESPONSE"
echo ""

# Extract dual side position
DUAL_SIDE=$(echo "$RESPONSE" | jq -r '.positions[0].positionSide' 2>/dev/null)
if [ "$DUAL_SIDE" == "BOTH" ]; then
    echo "✅ Conta em One-Way Mode (positionSide: BOTH)"
elif [ "$DUAL_SIDE" == "LONG" ] || [ "$DUAL_SIDE" == "SHORT" ]; then
    echo "✅ Conta em Hedge Mode (positionSide: LONG/SHORT)"
else
    echo "❓ Mode não detectado ou erro na resposta"
fi
echo ""

echo "=========================================================="
echo "TESTE 3: ORDEM SEM positionSide (One-Way Mode)"
echo "=========================================================="
TIMESTAMP=$(date +%s000)
BODY="symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 POST $BASE_URL/fapi/v1/order"
echo "📦 Body: $BODY (SEM positionSide)"
echo ""

RESPONSE=$(curl -s -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -X POST \
  -H "X-MBX-APIKEY: $API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "$BODY&signature=$SIGNATURE" \
  "$BASE_URL/fapi/v1/order")

echo "📥 Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q '"code"'; then
    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null)
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.msg' 2>/dev/null)
    echo "❌ ERRO: Code $ERROR_CODE - $ERROR_MSG"

    if [ "$ERROR_CODE" == "-4061" ]; then
        echo "⚠️  ERRO -4061: Position side não corresponde à configuração da conta"
        echo "   Isso indica que a conta PODE estar em Hedge Mode e precisa de positionSide"
    elif [ "$ERROR_CODE" == "-2015" ]; then
        echo "⚠️  ERRO -2015: API key, IP ou permissões inválidas"
    fi
else
    echo "✅ Ordem executada com sucesso (sem positionSide)"
fi
echo ""

echo "=========================================================="
echo "TESTE 4: ORDEM COM positionSide=LONG (Hedge Mode)"
echo "=========================================================="
TIMESTAMP=$(date +%s000)
BODY="symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&positionSide=LONG&timestamp=$TIMESTAMP"
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

echo "📡 POST $BASE_URL/fapi/v1/order"
echo "📦 Body: $BODY (COM positionSide=LONG)"
echo ""

RESPONSE=$(curl -s -x "http://$PROXY_USER:$PROXY_PASS@$PROXY_HOST:$PROXY_PORT" \
  -X POST \
  -H "X-MBX-APIKEY: $API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "$BODY&signature=$SIGNATURE" \
  "$BASE_URL/fapi/v1/order")

echo "📥 Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q '"code"'; then
    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null)
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.msg' 2>/dev/null)
    echo "❌ ERRO: Code $ERROR_CODE - $ERROR_MSG"

    if [ "$ERROR_CODE" == "-4061" ]; then
        echo "⚠️  ERRO -4061: Position side não corresponde à configuração da conta"
        echo "   Isso indica que a conta está em One-Way Mode e NÃO aceita positionSide"
    fi
else
    echo "✅ Ordem executada com sucesso (com positionSide=LONG)"
fi
echo ""

echo "=========================================================="
echo "📊 DIAGNÓSTICO FINAL"
echo "=========================================================="
echo "Este teste revelará:"
echo "1. Se a API key está válida (TESTE 1)"
echo "2. Qual mode a conta está configurada (TESTE 2)"
echo "3. Se aceita ordem sem positionSide (TESTE 3)"
echo "4. Se aceita ordem com positionSide (TESTE 4)"
echo ""
echo "✅ TESTES CONCLUÍDOS"
