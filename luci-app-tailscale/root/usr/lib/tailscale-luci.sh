#!/bin/sh
# Shared helpers. Every CLI argument is passed as a separate quoted word.
. /lib/functions.sh 2>/dev/null || true
# Offline .run dependencies are private; never alter global system libraries.
if [ -x /usr/lib/tailscale-luci/runtime/bin/jshn ]; then
    PATH=/usr/lib/tailscale-luci/runtime/bin:$PATH
    SSL_CERT_FILE=/usr/lib/tailscale-luci/runtime/etc/ssl/certs/ca-certificates.crt
    export PATH SSL_CERT_FILE
    . /usr/lib/tailscale-luci/runtime/usr/share/libubox/jshn.sh
else
    . /usr/share/libubox/jshn.sh 2>/dev/null || true
fi
TS_CLI=${TS_CLI:-/usr/sbin/tailscale}
TS_RUN_DIR=${TS_RUN_DIR:-/var/run/tailscale}
TS_ROUTE_CHECK=${TS_ROUTE_CHECK:-/usr/libexec/tailscale-route-check.awk}
TS_SOCKET=${TS_SOCKET:-/var/run/tailscale/tailscaled.sock}

# LocalAPI reads do not spawn the Go CLI. Preferences are filtered in memory;
# the private snapshot never contains Persist or credentials.
ts_api() {
	curl -fsS --noproxy '*' --unix-socket "$TS_SOCKET" \
		--connect-timeout 1 --max-time 3 --max-filesize 2097152 \
		"http://local-tailscaled.sock/localapi/v0/$1" 7>&- 8>&- 9>&- 2>/dev/null
}

ts_invalidate() {
	local token
	umask 077; mkdir -p "$TS_RUN_DIR"
	token=$(mktemp "$TS_RUN_DIR/epoch.XXXXXX") || return 1
	printf '%s\n' "${token##*/}" > "$token" && mv "$token" "$TS_RUN_DIR/snapshot-epoch"
}

ts_metadata() {
	local prefs=$1 now=$2 epoch=$3 routes route
	routes=$(printf '%s\n' "$prefs" | jsonfilter -e '@.AdvertiseRoutes[*]' 2>/dev/null)
	json_init
	json_add_string epoch "$epoch"
	json_add_int fetched_at "$now"
	json_add_boolean accept "$([ "$(printf '%s\n' "$prefs" | jsonfilter -e '@.RouteAll')" = true ] && echo 1 || echo 0)"
	json_add_string server "$(printf '%s\n' "$prefs" | jsonfilter -e '@.ControlURL')"
	json_add_array routes
	for route in $routes; do json_add_string "" "$route"; done
	json_close_array
	json_dump
}

ts_snapshot() {
	local now stamp raw prefs accept epoch cached_epoch meta result=0
	TS_SNAPSHOT_ERROR=""; TS_SNAPSHOT_STALE=0
	umask 077
	mkdir -p "$TS_RUN_DIR"; chmod 700 "$TS_RUN_DIR"
	now=$(date +%s)
	stamp=$(jsonfilter -i "$TS_RUN_DIR/snapshot-status" -e '@._LuCI.fetched_at' 2>/dev/null)
	epoch=$(cat "$TS_RUN_DIR/snapshot-epoch" 2>/dev/null)
	cached_epoch=$(jsonfilter -i "$TS_RUN_DIR/snapshot-status" -e '@._LuCI.epoch' 2>/dev/null)
	case "$stamp" in ''|*[!0-9]*) stamp=0;; esac
	if [ "${1:-}" != fresh ] && [ "$epoch" = "$cached_epoch" ] && [ "$now" -ge "$stamp" ] && [ "$((now - stamp))" -lt 5 ]; then
		return 0
	fi
	# Kernel advisory locks release even after SIGKILL; never unlink lock files.
	exec 9> "$TS_RUN_DIR/snapshot.lock" || return 1
	if ! flock -n 9; then
		exec 9>&-
		TS_SNAPSHOT_ERROR='Status refresh is in progress.'; TS_SNAPSHOT_STALE=1; return 2
	fi
	raw=$(ts_api status) || result=1
	[ "$result" -ne 0 ] || [ -n "$(printf '%s\n' "$raw" | jsonfilter -e '@.BackendState' 2>/dev/null)" ] || result=1
	if [ "$result" -eq 0 ]; then
		prefs=$(ts_api prefs) || result=1
	fi
	if [ "$result" -eq 0 ]; then
		accept=$(printf '%s\n' "$prefs" | jsonfilter -e '@.RouteAll' 2>/dev/null)
		case "$accept" in true|false) :;; *) result=1;; esac
	fi
	if [ "$result" -eq 0 ]; then
		meta=$(ts_metadata "$prefs" "$(date +%s)" "$epoch") || result=1
	fi
	if [ "$result" -eq 0 ]; then
		{ printf '%s\n' "$raw" | sed '$s/}[[:space:]]*$//'; printf ',"_LuCI":%s}\n' "$meta"; } > "$TS_RUN_DIR/snapshot-status.tmp.$$" || result=1
		[ "$result" -ne 0 ] || jsonfilter -i "$TS_RUN_DIR/snapshot-status.tmp.$$" -e '@._LuCI.fetched_at' >/dev/null 2>&1 || result=1
	fi
	if [ "$result" -eq 0 ] && [ "$epoch" != "$(cat "$TS_RUN_DIR/snapshot-epoch" 2>/dev/null)" ]; then result=2; fi
	if [ "$result" -eq 0 ]; then
		mv "$TS_RUN_DIR/snapshot-status.tmp.$$" "$TS_RUN_DIR/snapshot-status" || result=1
	fi
	if [ "$result" -eq 0 ] && [ "$epoch" != "$(cat "$TS_RUN_DIR/snapshot-epoch" 2>/dev/null)" ]; then result=2; fi
	if [ "$result" -ne 0 ]; then
		rm -f "$TS_RUN_DIR/snapshot-status.tmp.$$"
		TS_SNAPSHOT_ERROR='Cannot read local Tailscale status. Check the service and control connection.'
		TS_SNAPSHOT_STALE=1
	fi
	exec 9>&-
	return "$result"
}

ts_pref() {
	case "$1" in accept|server|routes)
		jsonfilter -i "$TS_RUN_DIR/snapshot-status" -e "@._LuCI.$1$([ "$1" = routes ] && echo '[*]')" 2>/dev/null;;
	esac
}

ts_terminate() {
	kill "$1" 2>/dev/null
	sleep 1
	kill -0 "$1" 2>/dev/null && kill -KILL "$1" 2>/dev/null
	wait "$1" 2>/dev/null
}

ts_capture() (
	local child count=0 result file="$TS_RUN_DIR/capture.$$"
	umask 077; mkdir -p "$TS_RUN_DIR"
	"$@" 7>&- 8>&- 9>&- > "$file" 2>&1 & child=$!
	trap 'kill "$child" 2>/dev/null; rm -f "$file"; exit 1' HUP INT TERM
	while kill -0 "$child" 2>/dev/null; do
		if [ "$count" -ge 15 ]; then
			ts_terminate "$child"
			rm -f "$file"; echo 'Tailscale operation timed out.'; exit 124
		fi
		sleep 1; count=$((count + 1))
	done
	wait "$child"; result=$?
	sed 's/tskey-[A-Za-z0-9_-]*/[redacted]/g' "$file"
	rm -f "$file"
	exit "$result"
)

ts_error() {
	mkdir -p "$TS_RUN_DIR"
	umask 077
	printf '%s\n' "$*" | sed 's/tskey-[A-Za-z0-9_-]*/[redacted]/g' > "$TS_RUN_DIR/luci-error.tmp.$$"
	mv "$TS_RUN_DIR/luci-error.tmp.$$" "$TS_RUN_DIR/luci-error"
	logger -t tailscale-luci "$(cat "$TS_RUN_DIR/luci-error")"
	return 1
}

ts_clear_error() { rm -f "$TS_RUN_DIR/luci-error"; }

# Release 8 splits forwarding directions and adopts the requested zone defaults.
# Preserve identity/login/routes and policies already explicitly saved by v8.
ts_migrate_config() {
	local forward input
	config_load tailscale
	config_get forward auto forward ""
	[ -z "$forward" ] || return 0
	config_get input auto input REJECT
	case "$input" in ''|ACCEPT) uci set tailscale.auto.input=REJECT;; esac
	uci set tailscale.auto.output=ACCEPT
	uci set tailscale.auto.forward=REJECT
	uci set tailscale.auto.tailscale_to_lan=0
	uci commit tailscale
	config_load tailscale
}

ts_read_config() {
	config_load tailscale
	config_get_bool ts_accept settings accept_routes 0
	config_get ts_hostname settings hostname ""
	config_get ts_auth settings auth_key ""
	config_get ts_server settings login_server ""
	config_get_bool ts_ssh settings ssh 0
	config_get_bool ts_offer_exit settings advertise_exit_node 0
	config_get ts_exit settings exit_node ""
	config_get_bool ts_exit_lan settings exit_allow_lan 1
	ts_routes=$(uci -q get tailscale.settings.advertise_routes | tr ' ' ',')
	# Do not expose stored auth keys to ordinary local users.
	[ ! -f /etc/config/tailscale ] || chmod 600 /etc/config/tailscale
}

ts_validate() {
	case "$ts_hostname" in *[!a-zA-Z0-9.-]*) ts_error 'Device name may contain only letters, digits, dots and hyphens.'; return 1;; esac
	case "$ts_exit" in */*|*[!a-zA-Z0-9.:-]*) ts_error 'Exit node must be a Tailscale IP or device name, not a subnet.'; return 1;; esac
	case "$ts_server" in '') :;; https://?*)
		case "$ts_server" in *[[:space:]]*) ts_error 'Control server URL must not contain spaces.'; return 1;; esac;;
		*) ts_error 'Headscale server must be a complete HTTPS URL.'; return 1;;
	esac
	local out
	out=$(printf '%s\n' "$ts_routes" | tr ',' '\n' | awk 'NF { print "advertise " $0 }' | awk -f "$TS_ROUTE_CHECK") || {
		ts_error "$out"; return 1
	}
}

ts_backend_state() {
	ts_snapshot || return 1
	jsonfilter -i "$TS_RUN_DIR/snapshot-status" -e '@.BackendState' 2>/dev/null
}

ts_wait_backend() {
	local count=0 state
	while [ "$count" -lt 30 ]; do
		state=$(ts_backend_state)
		case "$state" in Running|Stopped|NeedsLogin|NeedsMachineAuth) TS_BACKEND_STATE=$state; return 0;; esac
		sleep 1
		count=$((count + 1))
	done
	return 1
}

# Inspect all approved peer routes, including routes from offline peers.
# Exclude tailscale0 itself; protect every other connected IPv4/IPv6 network.
ts_check_conflicts() {
	local raw locals remotes out result=0
	ts_snapshot || result=$?
	[ "$result" -ne 2 ] || return 2
	[ "$result" -eq 0 ] || { ts_error 'Cannot inspect peer routes; remote subnet access was not enabled.'; return 1; }
	raw=$(cat "$TS_RUN_DIR/snapshot-status")
	[ -n "$(printf '%s' "$raw" | jsonfilter -e '@.BackendState' 2>/dev/null)" ] || {
		ts_error 'Cannot parse peer routes; remote subnet access was not enabled.'; return 1
	}
	locals=$({ ip -o -4 addr show scope global; ip -o -6 addr show scope global; } 2>/dev/null |
		awk '$2 !~ /^tailscale0$/ && ($3 == "inet" || $3 == "inet6") { a=$4; if (a !~ /\//) a=a "/32"; print "local " a }')
	[ -n "$locals" ] || { ts_error 'Cannot inspect local networks; remote subnet access was not enabled.'; return 1; }
	remotes=$({ printf '%s' "$raw" | jsonfilter -e '@.Peer[*].AllowedIPs[*]';
		printf '%s' "$raw" | jsonfilter -e '@.Peer[*].PrimaryRoutes[*]'; } 2>/dev/null | sort -u | awk 'NF { print "remote " $0 }')
	out=$(printf '%s\n%s\n' "$locals" "$remotes" | awk -f "$TS_ROUTE_CHECK") || {
		ts_error "$out"; return 1
	}
}

# Run bounded CLI calls and preserve errors. Auth keys are read from a 0600 file.
ts_run() {
	local child count=0 result out file="$TS_RUN_DIR/command.$$"
	mkdir -p "$TS_RUN_DIR"
	umask 077
	"$@" 7>&- 8>&- 9>&- > "$file" 2>&1 &
	child=$!
	while kill -0 "$child" 2>/dev/null; do
		if [ "$count" -ge 65 ]; then
			ts_terminate "$child"
			rm -f "$file"
			ts_error 'Tailscale operation timed out. Check the login state and try again.'
			return 1
		fi
		sleep 1; count=$((count + 1))
	done
	wait "$child"; result=$?
	if [ "$result" -ne 0 ]; then
		out=$(sed '/To authenticate/,$d' "$file" | tail -n 10)
		rm -f "$file"
		ts_error "${out:-Tailscale command failed (exit $result).}"
		return "$result"
	fi
	rm -f "$file"
	ts_invalidate
	return 0
}

ts_set_prefs() {
	local accept=false offer=false ssh=false lan=false
	[ "$ts_accept" -ne 1 ] || accept=true
	[ "$ts_offer_exit" -ne 1 ] || offer=true
	[ "$ts_ssh" -ne 1 ] || ssh=true
	[ -z "$ts_exit" ] || [ "$ts_exit_lan" -ne 1 ] || lan=true
	local check=0
	if [ "$accept" = true ]; then ts_check_conflicts || check=$?; fi
	if [ "$check" -eq 2 ]; then
		ts_error 'Status refresh is in progress. Apply settings again shortly.'; return 2
	fi
	if [ "$check" -ne 0 ]; then
		# Recover local management if a conflicting route is already installed.
		ts_run "$TS_CLI" set --accept-routes=false
		return 1
	fi
	ts_run "$TS_CLI" set "--accept-routes=$accept" "--hostname=$ts_hostname" \
		"--advertise-routes=$ts_routes" "--ssh=$ssh" "--advertise-exit-node=$offer" \
		"--exit-node=$ts_exit" "--exit-node-allow-lan-access=$lan"
}

ts_login_worker() {
	local server=${ts_server:-https://controlplane.tailscale.com} result
	# Never accept unknown routes until authenticated and inspected.
	set -- "$TS_CLI" login "--login-server=$server" --accept-routes=false --timeout=60s
	if [ -n "$ts_auth" ]; then
		umask 077
		printf '%s' "$ts_auth" > "$TS_RUN_DIR/authkey.$$"
		set -- "$@" "--auth-key=file:$TS_RUN_DIR/authkey.$$"
	fi
	ts_run "$@"; result=$?
	rm -f "$TS_RUN_DIR/authkey.$$"
	[ "$result" -eq 0 ] || return "$result"
	ts_set_prefs || return $?
	ts_clear_error
}

ts_apply_locked() {
	local state server current
	ts_read_config
	ts_validate || return $?
	ts_wait_backend || { ts_error 'Tailscale is not ready. Check DNS/Fake-IP and control-server connectivity. Settings will retry when the daemon becomes ready.'; return 1; }
	state=$TS_BACKEND_STATE
	case "$state" in
		NeedsLogin)
			[ -n "$ts_auth" ] || return 0
			ts_login_worker; return $?;;
		NeedsMachineAuth) ts_error 'Approve this device in the Tailscale admin console before applying settings.'; return 1;;
	esac
	server=${ts_server:-https://controlplane.tailscale.com}
	current=$(ts_pref server)
	if [ -n "$current" ] && [ "$current" != "$server" ]; then
		ts_error 'Changing control server requires Logout then Login. Other settings were not changed.'; return 1
	fi
	ts_set_prefs || return $?
	[ "$state" != Stopped ] || ts_run "$TS_CLI" up || return $?
	ts_clear_error
}

# FD 7 guards all CLI mutations. FD 8 is the RPC service-operation gate.
# Background login inherits its lock until the worker exits.
ts_lock() {
	umask 077; mkdir -p "$TS_RUN_DIR"
	exec 7> "$TS_RUN_DIR/operation.lock" || return 1
	flock -n 7 || { exec 7>&-; return 1; }
}

ts_busy() {
	[ -f "$TS_RUN_DIR/operation.lock" ] || return 1
	! flock -n "$TS_RUN_DIR/operation.lock" true
}

ts_apply() {
	local result
	ts_lock || { ts_error 'Another Tailscale operation is still running.'; return 1; }
	trap 'exec 7>&-; exit 1' HUP INT TERM
	ts_apply_locked; result=$?
	exec 7>&-
	trap - HUP INT TERM
	return "$result"
}

ts_login() {
	ts_read_config
	ts_validate || return $?
	ts_lock || { ts_error 'Another Tailscale operation is still running.'; return 1; }
	ts_clear_error
	( trap 'exit 1' HUP INT TERM; ts_login_worker ) </dev/null >/dev/null 2>&1 &
	exec 7>&-
}

# Quote valid JSON text as a legacy RPC string without a large argv/env value.
ts_json_quote() {
	printf '"'
	# Literal tabs/CR can only be whitespace in valid JSON; escaped string
	# controls remain intact. sed streams large values without shell argv limits.
	tr '\t\r' '  ' | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '
	NR > 1 { printf "%c%s",92,"n" }
	{ printf "%s",$0 }'
	printf '"'
}
