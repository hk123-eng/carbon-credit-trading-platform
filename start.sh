#!/bin/bash
echo ""
echo "  Starting Carbon Credit Platform..."
echo ""
cd "$(dirname "$0")/backend"
if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi
echo "  Launching server at http://localhost:3001"
npm start
