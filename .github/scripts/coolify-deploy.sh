#!/usr/bin/env bash
#
# Trigger a Coolify deployment and wait for it to finish.
#
#   coolify-deploy.sh <resource-uuid> <label>
#
# Coolify's deploy endpoint returns immediately with a deployment uuid; on its
# own that only proves the request was accepted. This polls until the
# deployment reaches a terminal state, so a broken build fails the workflow
# instead of showing a green tick over a rolled-back container.
#
# Requires: COOLIFY_URL, COOLIFY_TOKEN.

set -euo pipefail

uuid="${1:?usage: coolify-deploy.sh <resource-uuid> <label>}"
label="${2:-resource}"

: "${COOLIFY_URL:?COOLIFY_URL is not set}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is not set}"

base="${COOLIFY_URL%/}"

api() {
	curl -sS --fail-with-body \
		-H "Authorization: Bearer ${COOLIFY_TOKEN}" \
		-H 'Accept: application/json' \
		"$@"
}

echo "Deploying ${label} (${uuid})…"

response="$(api -X POST "${base}/api/v1/deploy?uuid=${uuid}&force=false")"
echo "${response}"

deployment="$(printf '%s' "${response}" | jq -r '.deployments[0].deployment_uuid // empty')"

if [ -z "${deployment}" ]; then
	echo "::warning::Coolify accepted the request but returned no deployment uuid; cannot follow progress."
	exit 0
fi

echo "Deployment ${deployment} queued. Waiting…"

# 60 × 20s = 20 minutes. A WordPress image build is the slow case.
for attempt in $(seq 1 60); do
	sleep 20

	status="$(api "${base}/api/v1/deployments/${deployment}" | jq -r '.status // "unknown"')"

	case "${status}" in
		finished)
			echo "${label}: deployment finished."
			exit 0
			;;
		failed|cancelled-by-user|error)
			echo "::error::${label}: deployment ${status}. See ${base}/ for the build log."
			exit 1
			;;
		*)
			echo "  ${label}: ${status} (attempt ${attempt}/60)"
			;;
	esac
done

echo "::error::${label}: timed out after 20 minutes waiting for the deployment."
exit 1
