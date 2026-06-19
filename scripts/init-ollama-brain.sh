#!/bin/sh
# ── CentralBrain Ollama Initialization ─────────────────────────────────
# Pre-pulls the nomic-embed-text model for semantic lesson search.
# Run this on the VPS or locally after docker compose up -d ollama.
#
# Usage:  sh scripts/init-ollama-brain.sh
#         curl -fsS http://localhost:11434/api/tags  # verify

set -e

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
MODEL="${MODEL:-nomic-embed-text}"

echo "🧠 CentralBrain — Pulling embedding model: ${MODEL}"
echo "   Ollama URL: ${OLLAMA_URL}"
echo ""

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama to be ready..."
for i in $(seq 1 30); do
  if curl -fsS "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    echo "   ✅ Ollama is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "   ❌ Ollama did not become ready. Is it running?"
    exit 1
  fi
  sleep 2
done

# Check if model already exists
if curl -fsS "${OLLAMA_URL}/api/tags" | grep -q "\"name\":\"${MODEL}\""; then
  echo "   ✅ ${MODEL} is already pulled"
  exit 0
fi

# Pull the embedding model (small — ~274MB)
echo "   📦 Pulling ${MODEL} (~274MB)..."
curl -fsS "${OLLAMA_URL}/api/pull" -d "{\"model\":\"${MODEL}\"}" | while read -r line; do
  status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$status" ]; then
    printf "\r   📥 %-40s" "$status"
  fi
done
echo ""
echo "   ✅ ${MODEL} pulled successfully"

# Test embedding generation
echo ""
echo "🧪 Testing embedding generation..."
TEST_RESULT=$(curl -fsS "${OLLAMA_URL}/api/embeddings" \
  -d "{\"model\":\"${MODEL}\",\"prompt\":\"CentralBrain test embedding\"}")
EMBEDDING_LEN=$(echo "$TEST_RESULT" | grep -o '"embedding":\[[^]]*\]' | tr ',' '\n' | wc -l)
echo "   ✅ Embedding generated: ${EMBEDDING_LEN}-dimensional vector"
echo ""
echo "🎉 CentralBrain is ready! Lessons will now be automatically embedded."
