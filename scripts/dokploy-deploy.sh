#!/usr/bin/env bash
#
# Dokploy deployment helper.
#
#   export DOKPLOY_URL=https://dashboard.example.com
#   export DOKPLOY_KEY=…            # Settings -> API/Tokens
#
#   ./dokploy-deploy.sh health
#   ./dokploy-deploy.sh project "My Project"
#   ./dokploy-deploy.sh sshkey myrepo-deploy ./dk_deploy
#   ./dokploy-deploy.sh compose <envId> btk-wordpress
#   ./dokploy-deploy.sh compose-git <composeId> git@github.com:o/r.git main <sshKeyId> ./docker-compose.dokploy.yml
#   ./dokploy-deploy.sh compose-env <composeId> ./cms.env
#   ./dokploy-deploy.sh app <envId> btk-web
#   ./dokploy-deploy.sh app-git <appId> git@github.com:o/r.git main <sshKeyId> web/Dockerfile web
#   ./dokploy-deploy.sh app-env <appId> ./runtime.env ./build.env
#   ./dokploy-deploy.sh domain-app <appId> example.com 4321
#   ./dokploy-deploy.sh domain-compose <composeId> wordpress cms.example.com 80
#   ./dokploy-deploy.sh deploy-compose <composeId>
#   ./dokploy-deploy.sh deploy-app <appId>
#   ./dokploy-deploy.sh wait-app <appId>
#   ./dokploy-deploy.sh logs <deploymentId>
#   ./dokploy-deploy.sh verify <https://example.com> </api/form-endpoint>
#
# Every write command echoes the response. Read config back with `show-app` /
# `show-compose` before deploying — several Dokploy endpoints accept a payload
# and silently keep the old value.

set -euo pipefail

: "${DOKPLOY_URL:?set DOKPLOY_URL}"
: "${DOKPLOY_KEY:?set DOKPLOY_KEY}"

api() {
	local method="$1" path="$2"
	shift 2
	curl -s --max-time 120 -X "${method}" "${DOKPLOY_URL}/api/${path}" \
		-H "x-api-key: ${DOKPLOY_KEY}" \
		-H 'Content-Type: application/json' "$@"
}

# Turn a dotenv file into a JSON string safely (quotes, newlines, unicode).
env_to_json() {
	python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$1"
}

pretty() { python3 -m json.tool 2>/dev/null || cat; }

cmd="${1:-help}"
shift || true

case "${cmd}" in

health)
	api GET settings.health | pretty
	api GET user.get | python3 -c 'import sys,json; d=json.load(sys.stdin); print("organizationId:", d["organizationId"])'
	;;

openapi)
	api GET settings.getOpenApiDocument -o /tmp/dkapi.json
	python3 -c 'import json; print(len(json.load(open("/tmp/dkapi.json"))["paths"]), "paths -> /tmp/dkapi.json")'
	;;

# Print the request schema for one endpoint, e.g. `schema /application.saveEnvironment`
schema)
	[[ -f /tmp/dkapi.json ]] || api GET settings.getOpenApiDocument -o /tmp/dkapi.json
	python3 - "$1" <<-'EOF'
		import json, sys
		d = json.load(open('/tmp/dkapi.json'))
		s = d['paths'][sys.argv[1]]['post']['requestBody']['content']['application/json']['schema']
		if '$ref' in s:
		    s = d['components']['schemas'][s['$ref'].split('/')[-1]]
		req = s.get('required', [])
		for k, v in s.get('properties', {}).items():
		    t = v.get('type') or ('enum=' + str(v['enum']) if 'enum' in v else '?')
		    print(f"{'*' if k in req else ' '} {k}: {t}")
	EOF
	;;

project)
	api POST project.create -d "$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"description":sys.argv[2] if len(sys.argv)>2 else ""}))' "$1" "${2:-}")" | pretty
	;;

# sshkey <name> <private-key-path>   (expects <path>.pub alongside)
sshkey)
	org=$(api GET user.get | python3 -c 'import sys,json; print(json.load(sys.stdin)["organizationId"])')
	python3 - "$1" "$2" "${org}" > /tmp/dk_sshkey.json <<-'EOF'
		import json, sys
		name, path, org = sys.argv[1], sys.argv[2], sys.argv[3]
		print(json.dumps({
			"name": name,
			"description": "Read-only deploy key",
			"privateKey": open(path).read(),
			"publicKey": open(path + ".pub").read().strip(),
			"organizationId": org,
		}))
	EOF
	api POST sshKey.create --data @/tmp/dk_sshkey.json | pretty
	echo "Now add the public half as a read-only deploy key:"
	echo "  gh api -X POST repos/<owner>/<repo>/keys -f title='Dokploy deploy' -f key=\"\$(cat $2.pub)\" -F read_only=true"
	;;

compose)
	api POST compose.create -d "{\"name\":\"$2\",\"environmentId\":\"$1\",\"composeType\":\"docker-compose\",\"appName\":\"$2\"}" | pretty
	;;

# compose-git <composeId> <gitUrl> <branch> <sshKeyId> <composePath>
compose-git)
	api POST compose.update -d "{
		\"composeId\":\"$1\",\"sourceType\":\"git\",
		\"customGitUrl\":\"$2\",\"customGitBranch\":\"$3\",\"customGitSSHKeyId\":\"$4\",
		\"composePath\":\"$5\",\"composeType\":\"docker-compose\"}" | head -c 200
	echo
	;;

compose-env)
	api POST compose.saveEnvironment -d "{\"composeId\":\"$1\",\"env\":$(env_to_json "$2")}" | pretty
	;;

app)
	api POST application.create -d "{\"name\":\"$2\",\"environmentId\":\"$1\",\"appName\":\"$2\"}" | pretty
	;;

# app-git <appId> <gitUrl> <branch> <sshKeyId> <dockerfile> <contextPath>
# Paths are REPO-ROOT relative. customGitBuildPath stays "/" — it does not
# become the docker build context. See references/gotchas.md #1.
app-git)
	api POST application.update -d "{
		\"applicationId\":\"$1\",\"sourceType\":\"git\",
		\"customGitUrl\":\"$2\",\"customGitBranch\":\"$3\",\"customGitSSHKeyId\":\"$4\",
		\"customGitBuildPath\":\"/\",\"buildType\":\"dockerfile\",
		\"dockerfile\":\"$5\",\"dockerContextPath\":\"$6\"}" | head -c 200
	echo
	;;

# app-env <appId> <runtime.env> [build.env]
# buildSecrets is sent empty but present — the call 400s without it.
app-env)
	local_build="${3:-/dev/null}"
	api POST application.saveEnvironment -d "{
		\"applicationId\":\"$1\",
		\"env\":$(env_to_json "$2"),
		\"buildArgs\":$(env_to_json "${local_build}"),
		\"buildSecrets\":\"\",
		\"createEnvFile\":false}" | pretty
	;;

domain-app)
	api POST domain.create -d "{
		\"host\":\"$2\",\"port\":${3:-3000},\"https\":true,\"certificateType\":\"letsencrypt\",
		\"applicationId\":\"$1\",\"domainType\":\"application\",\"path\":\"/\",
		\"stripPath\":false,\"forwardAuthEnabled\":false}" | head -c 160
	echo
	;;

# domain-compose <composeId> <serviceName> <host> [port]
domain-compose)
	api POST domain.create -d "{
		\"host\":\"$3\",\"port\":${4:-80},\"https\":true,\"certificateType\":\"letsencrypt\",
		\"composeId\":\"$1\",\"serviceName\":\"$2\",\"domainType\":\"compose\",\"path\":\"/\",
		\"stripPath\":false,\"forwardAuthEnabled\":false}" | head -c 160
	echo
	;;

deploy-compose) api POST compose.deploy -d "{\"composeId\":\"$1\"}" | pretty ;;
deploy-app)     api POST application.deploy -d "{\"applicationId\":\"$1\"}" | pretty ;;

show-app)     api GET "application.one?applicationId=$1" | pretty ;;
show-compose) api GET "compose.one?composeId=$1" | pretty ;;

# wait-app <applicationId> — poll until done/error, then print the deployment id
wait-app)
	for _ in $(seq 1 60); do
		out=$(api GET "deployment.all?applicationId=$1" |
			python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["status"], d[0]["deploymentId"])' 2>/dev/null || echo "? ?")
		echo "  ${out}"
		case "${out}" in done\ *|error\ *) break ;; esac
		sleep 15
	done
	;;

logs)
	api GET "deployment.readLogs?deploymentId=$1" -o /tmp/dk_log.json
	python3 - <<-'EOF'
		import json
		raw = open('/tmp/dk_log.json').read()
		try:
		    t = json.loads(raw)
		    t = t if isinstance(t, str) else json.dumps(t)
		except Exception:
		    t = raw
		t = t.replace('\\n', '\n').replace('\\r', '\n')
		noise = ('Counting objects', 'Compressing objects', 'Receiving objects', 'Resolving deltas')
		lines = [l for l in t.split('\n') if l.strip() and not any(n in l for n in noise)]
		print('\n'.join(lines[-40:]))
	EOF
	;;

# verify <site-url> <form-endpoint> — the checks that only fail in production
verify)
	site="$1" endpoint="${2:-}"
	echo "=== TLS ==="
	# Captured rather than piped straight into grep: `grep -m1` closes the pipe
	# early, curl dies on SIGPIPE, and under `set -o pipefail` the whole
	# pipeline reports failure even though the certificate was found.
	issuer=$(curl -sv --max-time 20 "${site}/" 2>&1 | grep -m1 'issuer:' || true)

	if [[ -n "${issuer}" ]]; then
		echo "  ${issuer}"
	else
		echo "  no certificate issued yet — see references/gotchas.md #9"
	fi
	echo "=== reachability ==="
	curl -s -o /dev/null -w "  %{http_code}  ${site}/\n" --max-time 20 "${site}/"
	if [[ -n "${endpoint}" ]]; then
		echo "=== origin check (403 here = proxy/TLS mismatch, see gotchas #12) ==="
		curl -s --max-time 30 -X POST "${site}${endpoint}" \
			-H "Origin: ${site}" -H 'Content-Type: application/json' -d '{}' \
			-w "\n  http=%{http_code}\n"
	fi
	;;

*)
	sed -n '2,40p' "$0"
	;;
esac
