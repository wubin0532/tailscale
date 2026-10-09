#!/bin/sh
# Shared helpers. Every CLI argument is passed as a separate quoted word.
. /lib/functions.sh 2>/dev/null || true
TS_CLI=${TS_CLI:-/usr/sbin/tailscale}
TS_RUN_DIR=${TS_RUN_DIR:-/var/run/tailscale}
TS_ROUTE_CHECK=${TS_ROUTE_CHECK:-/usr/libexec/tailscale-route-check.awk}

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
	"$TS_CLI" status --json 2>/dev/null | jsonfilter -e '@.BackendState' 2>/dev/null
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
	local raw locals remotes out
	raw=$("$TS_CLI" status --json 2>/dev/null) || { ts_error 'Cannot inspect peer routes; remote subnet access was not enabled.'; return 1; }
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
	"$@" > "$file" 2>&1 &
	child=$!
	while kill -0 "$child" 2>/dev/null; do
		if [ "$count" -ge 65 ]; then
			kill "$child" 2>/dev/null
			wait "$child" 2>/dev/null
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
	return 0
}

ts_set_prefs() {
	local accept=false offer=false ssh=false lan=false
	[ "$ts_accept" -ne 1 ] || accept=true
	[ "$ts_offer_exit" -ne 1 ] || offer=true
	[ "$ts_ssh" -ne 1 ] || ssh=true
	[ -z "$ts_exit" ] || [ "$ts_exit_lan" -ne 1 ] || lan=true
	if [ "$accept" = true ] && ! ts_check_conflicts; then
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
	current=$("$TS_CLI" debug prefs 2>/dev/null | jsonfilter -e '@.ControlURL')
	if [ -n "$current" ] && [ "$current" != "$server" ]; then
		ts_error 'Changing control server requires Logout then Login. Other settings were not changed.'; return 1
	fi
	ts_set_prefs || return $?
	[ "$state" != Stopped ] || ts_run "$TS_CLI" up || return $?
	ts_clear_error
}

ts_apply() {
	local result
	mkdir -p "$TS_RUN_DIR"
	mkdir "$TS_RUN_DIR/luci-lock" 2>/dev/null || { ts_error 'Another Tailscale operation is still running.'; return 1; }
	trap 'rm -rf "$TS_RUN_DIR/luci-lock"; exit 1' HUP INT TERM
	ts_apply_locked; result=$?
	rm -rf "$TS_RUN_DIR/luci-lock"
	trap - HUP INT TERM
	return "$result"
}

ts_login() {
	ts_read_config
	ts_validate || return $?
	mkdir -p "$TS_RUN_DIR"
	mkdir "$TS_RUN_DIR/luci-lock" 2>/dev/null || { ts_error 'Another Tailscale operation is still running.'; return 1; }
	ts_clear_error
	( trap 'rm -rf "$TS_RUN_DIR/luci-lock"' EXIT
		trap 'exit 1' HUP INT TERM
		ts_login_worker ) </dev/null >/dev/null 2>&1 &
}
