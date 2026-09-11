#!/bin/sh
# shared helpers for luci-app-tailscale (sourced by init.d and rpcd scripts)

. /lib/functions.sh 2>/dev/null || true

TS_CLI=/usr/sbin/tailscale

# build tailscale up flags from UCI config; echoes to stdout
ts_build_args() {
	local accept_routes hostname auth_key login_server ssh \
	      advertise_exit_node exit_node exit_allow_lan routes=""

	config_load tailscale
	config_get_bool accept_routes settings accept_routes 0
	config_get hostname settings hostname ""
	config_get auth_key settings auth_key ""
	config_get login_server settings login_server ""
	config_get_bool ssh settings ssh 0
	config_get_bool advertise_exit_node settings advertise_exit_node 0
	config_get exit_node settings exit_node ""
	config_get_bool exit_allow_lan settings exit_allow_lan 1

	local routes=""
	local r
	local list
	list=$(uci -q get tailscale.settings.advertise_routes)
	for r in $list; do
		[ -n "$r" ] && routes="${routes:+$routes,}$r"
	done

	local args="--reset --timeout=60s"
	if [ "$accept_routes" -eq 1 ]; then
		args="$args --accept-routes=true"
	else
		args="$args --accept-routes=false"
	fi
	[ -n "$hostname" ] && args="$args --hostname=$hostname"
	[ -n "$routes" ] && args="$args --advertise-routes=$routes"
	[ -n "$auth_key" ] && args="$args --auth-key=$auth_key"
	[ -n "$login_server" ] && args="$args --login-server=$login_server"
	[ "$ssh" -eq 1 ] && args="$args --ssh=true"
	[ "$advertise_exit_node" -eq 1 ] && args="$args --advertise-exit-node"
	if [ -n "$exit_node" ]; then
		args="$args --exit-node=$exit_node"
		[ "$exit_allow_lan" -eq 1 ] && args="$args --exit-node-allow-lan-access=true"
	fi
	echo "$args"
}

ts_backend_state() {
	$TS_CLI status --json 2>/dev/null | jsonfilter -e '@.BackendState' 2>/dev/null
}

# Apply prefs only when already logged in (Running) or an auth key is set.
# Never triggers interactive login — that is done explicitly from the UI.
ts_apply() {
	local state auth_key
	state=$(ts_backend_state)
	config_load tailscale
	config_get auth_key settings auth_key ""
	[ "$state" = "Running" ] || [ -n "$auth_key" ] || return 0

	# intentional word splitting: args holds multiple CLI flags
	$TS_CLI up $(ts_build_args) >/dev/null 2>&1 || true
}

# User-initiated login from the UI: run up in the background, the auth URL
# becomes visible via ts_backend_state/get_status shortly after.
ts_login() {
	# intentional word splitting: args holds multiple CLI flags
	( $TS_CLI up $(ts_build_args) >/dev/null 2>&1 & )
}
