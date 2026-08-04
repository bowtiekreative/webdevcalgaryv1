#!/usr/bin/env bash
#
# Trigger a Dokploy deployment and wait for it to finish.
#
#   dokploy-deploy.sh app     <applicationId> <label>
#   dokploy-deploy.sh compose <composeId>     <label>
#
# Dokploy's deploy endpoints queue and return immediately, so on its own a
# successful call only proves the request was accepted. This polls to a terminal
# state, so a broken build fails the workflow instead of showing a green tick
# over a rolled-back container.
#
# Requires: DOKPLOY_URL, DOKPLOY_KEY.

set -euo pipefail

kind="${1:?usage: dokploy-deploy.sh <app|compose> <id> <label>}"
id="${2:?missing resource id}"
label="${3:-$kind}"

: "${DOKPLOY_URL:?DOKPLOY_URL is not set}"
: "${DOKPLOY_KEY:?DOKPLOY_KEY is not set}"

base="${DOKPLOY_URL%/}"

api() {
	curl -sS --max-time 90 -H "x-api-key: ${DOKPLOY_KEY}" -H 'Content-Type: application/json' "$@"
}

case "${kind}" in
	app)
		deploy_path='application.deploy'
		field='applicationId'
		list_path="deployment.all?applicationId=${id}"
		;;
	compose)
		deploy_path='compose.deploy'
		field='composeId'
		list_path="deployment.allByCompose?composeId=${id}"
		;;
	*)
		echo "::error::unknown kind '${kind}' — expected app or compose"
		exit 1
		;;
esac

echo "Deploying ${label} (${id})…"
api -X POST "${base}/api/${deploy_path}" -d "{\"${field}\":\"${id}\"}" >/dev/null

# 90 × 20s = 30 minutes. A WordPress image build is the slow case.
for attempt in $(seq 1 90); do
	sleep 20

	read -r status deployment < <(
		api "${base}/api/${list_path}" | python3 -c '
import json, sys

runs = json.load(sys.stdin)
print(runs[0]["status"], runs[0]["deploymentId"]) if runs else print("none", "-")
'
	)

	case "${status}" in
		done)
			echo "${label}: deployment finished."
			exit 0
			;;
		error)
			echo "::error::${label}: deployment failed. Build log follows."
			# deploymentId, not the logPath the record carries — passing that 400s.
			api "${base}/api/deployment.readLogs?deploymentId=${deployment}" | python3 -c '
import json, sys

raw = sys.stdin.read()

try:
    text = json.loads(raw)
    text = text if isinstance(text, str) else json.dumps(text)
except Exception:
    text = raw

text = text.replace("\\n", "\n").replace("\\r", "\n")
noise = ("Counting objects", "Compressing objects", "Receiving objects", "Resolving deltas")
lines = [l for l in text.split("\n") if l.strip() and not any(n in l for n in noise)]
print("\n".join(lines)[-4000:])
'
			exit 1
			;;
		*)
			echo "  ${label}: ${status} (attempt ${attempt}/90)"
			;;
	esac
done

echo "::error::${label}: timed out after 30 minutes waiting for the deployment."
exit 1
