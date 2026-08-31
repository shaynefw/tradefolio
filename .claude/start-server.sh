#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH
cd /Users/swmac/Downloads/\$CODE/tradefolio
exec npx tsx server/index.ts
