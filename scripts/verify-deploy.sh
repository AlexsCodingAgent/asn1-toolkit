#!/usr/bin/env bash
# Verify asn1.euicc.tech is live and serving the current deploy.
#
# Use this from a machine that cannot reach the site: it distinguishes
#     "the site is down"          (all checks fail)
#     "your DNS is stale"         (resolvers disagree, or your local one fails)
#     "the site is fine"          (everything passes)
#
# The DNS section is the important one. A stale negative cache on your device
# looks identical to an outage from inside a browser, but the resolvers below
# will disagree with each other if that is the cause.

set -uo pipefail

HOST=asn1.euicc.tech
EXPECT_MARKER='ASN.1 Compiler'

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

fail=0

echo "== DNS =="
dim "asking several resolvers; they should all agree"
declare -a RESOLVERS=("1.1.1.1" "8.8.8.8" "9.9.9.9" "system")
for r in "${RESOLVERS[@]}"; do
  if [ "$r" = "system" ]; then
    ans=$(dig +short "$HOST" A 2>/dev/null | sort | tr '\n' ' ')
    label="system default"
  else
    ans=$(dig "@$r" +short "$HOST" A 2>/dev/null | sort | tr '\n' ' ')
    label="$r"
  fi
  if [ -z "$ans" ]; then
    red   "  $label -> NO ANSWER"
    fail=1
  else
    green "  $label -> $ans"
  fi
done

echo
echo "== HTTP =="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$HOST/" 2>/dev/null)
if [ "$code" = "200" ]; then
  green "  https://$HOST -> 200"
else
  red   "  https://$HOST -> ${code:-no response}"
  fail=1
fi

echo
echo "== Is this the current deploy? =="
body=$(curl -s --max-time 20 "https://$HOST/" 2>/dev/null)
if printf '%s' "$body" | grep -q "$EXPECT_MARKER"; then
  green "  page contains '$EXPECT_MARKER'"
else
  red   "  page is missing '$EXPECT_MARKER' - wrong or stale content"
  fail=1
fi
# A file that only exists in the newer deploy: proves it is not an old cache.
ts=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$HOST/format-ts.js" 2>/dev/null)
if [ "$ts" = "200" ]; then
  green "  TypeScript formatter present (current deploy)"
else
  red   "  format-ts.js -> $ts (deploy may be stale)"
  fail=1
fi

echo
if [ $fail -eq 0 ]; then
  green "ALL CHECKS PASSED - the site is live and current."
  dim "If your browser still cannot load it, the fault is local DNS."
  dim "Try: https://104.21.11.220/ (accept the cert warning) - if that"
  dim "loads, the site is fine and your resolver is caching a stale miss."
else
  red "SOME CHECKS FAILED - see above."
fi

exit $fail
