'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require poll';
'require tailscale.ui-v2-r1 as tsui';

var callGetStatus = rpc.declare({
	object: 'tailscale',
	method: 'get_status',
	expect: { }
});

var callLogin = rpc.declare({
	object: 'tailscale',
	method: 'login',
	expect: { }
});

var callLogout = rpc.declare({
	object: 'tailscale',
	method: 'logout',
	expect: { }
});

var callUninstall = rpc.declare({
	object: 'tailscale',
	method: 'uninstall',
	expect: { }
});

var callNetcheck = rpc.declare({
	object: 'tailscale',
	method: 'get_netcheck',
	expect: { }
});

var callSetEnabled = rpc.declare({
	object: 'tailscale',
	method: 'set_enabled',
	params: [ 'enabled' ],
	expect: { }
});

return view.extend({
	loginRequested: false,
	loginModalShown: false,

	load: function() {
		if (!document.getElementById('ts-qrcode-lib'))
			document.head.appendChild(E('script', {
				'id': 'ts-qrcode-lib',
				'src': L.resource('tailscale/qrcode.min.js')
			}));
		return uci.load('tailscale');
	},

	render: function() {
		var checkbox = E('input', { type: 'checkbox', id: 'ts_enabled' });
		checkbox.checked = uci.get('tailscale', 'settings', 'enabled') == '1';
		checkbox.addEventListener('change', L.bind(this.handleEnable, this));
		var metrics = [[_('Current device'), 'ts_hostname'], [_('Daemon process'), 'ts_running'], [_('Control connection'), 'ts_online'], [_('Visible devices'), 'ts_count']];
		var details = [['Tailscale IP', 'ts_ips'], [_('Configured local subnets'), 'ts_routes'], [_('Applied local subnets'), 'ts_actual_routes'], [_('Remote subnet access in use'), 'ts_accept_routes'], [_('Bound User'), 'ts_user'], [_('Node public key'), 'ts_node'], [_('Core version'), 'ts_core_version']];
		var v = tsui.wrap(_('Tailscale'), _('Your router connection and private network at a glance.'), [
			E('div', { id: 'ts_alert_box' }),
			E('div', { id: 'ts_apply_error', 'class': 'ts-notice', role: 'status', 'aria-live': 'polite', style: 'display:none' }),
			E('section', { 'class': 'ts-card' }, [
				E('div', { 'class': 'ts-toolbar' }, [E('label', {}, [checkbox, ' ', _('Enable service')]), E('span', { id: 'ts_updated', 'class': 'ts-muted' })]),
				E('div', { 'class': 'ts-grid' }, metrics.map(function(row) { return E('div', { 'class': 'ts-metric' }, [E('small', {}, row[0]), E('strong', { id: row[1] }, '—')]); }))
			]),
			E('section', { 'class': 'ts-card' }, [
				E('h3', {}, _('Account & Connection')),
				E('div', { 'class': 'ts-toolbar' }, [E('span', { id: 'ts_login_desc' }, '—'), E('div', { id: 'ts_actions' }), E('button', { 'class': 'btn cbi-button ts-success', click: L.bind(this.handleNetcheck, this) }, _('Run netcheck'))]),
			]),
			E('section', { 'class': 'ts-card' }, [
				E('div', {}, [E('h3', {}, _('Connection details')), E('dl', {}, details.reduce(function(all, row) { return all.concat([E('dt', {}, row[0]), E('dd', { id: row[1] }, '—')]); }, []))])
			]),
			E('section', { 'class': 'ts-card ts-danger' }, [
				E('h3', {}, _('Identity and configuration cleanup')),
				E('p', {}, _('Remove this device identity and plugin configuration. The installed package remains. Sign in again after reinstalling.')),
				E('button', { 'class': 'btn cbi-button cbi-button-negative', click: L.bind(this.handleUninstall, this) }, _('Clear identity and configuration'))
			])
		]);
		poll.add(L.bind(this.updateStatus, this), 5); this.updateStatus();
		return v;
	},

	updateStatus: function() {
		if (this.fetching) return Promise.resolve(); this.fetching = true;
		return callGetStatus().then(L.bind(function(res) {
			var el = document.getElementById('ts_running'); if (!el) return;
			var message = res.apply_error ? _('Settings were not fully applied: %s').format(res.apply_error) : res.busy ? _('Applying settings or waiting for login...') : tsui.message(res);
			var errorBox = document.getElementById('ts_apply_error'); errorBox.textContent = message; errorBox.style.display = message ? '' : 'none';
			if (res.success === false || res.stale) { document.getElementById('ts_updated').textContent = tsui.updated(res.fetched_at) + ' · ' + _('Stale'); return; }
			el.textContent = res.running ? _('Running') : _('Stopped'); el.className = res.running ? 'ts-good' : 'ts-neutral';
			document.getElementById('ts_online').textContent = res.online ? _('Connected') : _('Disconnected or starting');
			document.getElementById('ts_hostname').textContent = res.hostname || '—';
			document.getElementById('ts_node').textContent = res.node_key || '—';
			document.getElementById('ts_ips').textContent = res.ips || '—';
			document.getElementById('ts_core_version').textContent = res.core_version || '—';
			document.getElementById('ts_updated').textContent = tsui.updated(res.fetched_at);
			var routes = uci.get('tailscale', 'settings', 'advertise_routes');
			document.getElementById('ts_routes').textContent = Array.isArray(routes) ? routes.filter(Boolean).join(', ') || '—' : routes || '—';
			document.getElementById('ts_actual_routes').textContent = res.actual_routes || '—';
			document.getElementById('ts_accept_routes').textContent = res.accept_routes ? _('Enabled') : _('Disabled');
			document.getElementById('ts_user').textContent = res.user || '—';
			var raw; try { raw = JSON.parse(res.raw || '{}'); } catch (e) { throw new Error(_('Invalid status response.')); }
			var peers = Object.keys(raw.Peer || {}).map(function(k) { return raw.Peer[k]; });
			document.getElementById('ts_count').textContent = _('%d online / %d total').format(peers.filter(function(p) { return p.Online; }).length, peers.length);
			if (!this.accountBusy) {
				var desc = document.getElementById('ts_login_desc'), act = document.getElementById('ts_actions');
				var action = res.backend_state === 'NeedsLogin' ? 'login' : res.user ? 'logout' : '';
				desc.textContent = action === 'login' ? _('Not logged in') : action === 'logout' ? _('Authorized') : res.backend_state || _('Stopped');
				if (this.accountAction !== action) {
					this.accountAction = action; act.textContent = '';
					if (action) act.appendChild(E('button', { 'class': 'btn cbi-button ' + (action === 'login' ? 'ts-success' : 'ts-warning'), click: L.bind(action === 'login' ? this.handleLogin : this.handleLogout, this) }, action === 'login' ? _('Login') : _('Logout & Unbind')));
				}
			}
			if (res.backend_state === 'NeedsLogin' && res.auth_url && (this.loginRequested || this.loginModalShown)) this.showLoginModal(res.auth_url);
			if (res.backend_state === 'Running') { this.loginRequested = false; if (this.loginModalShown) ui.hideModal(); this.loginModalShown = false; }
			this.renderKeyAlert(res);
		}, this)).catch(function(err) {
			var el = document.getElementById('ts_apply_error'); if (el) { el.textContent = err.message || String(err); el.style.display = ''; }
		}).finally(L.bind(function() { this.fetching = false; }, this));
	},

	renderKeyAlert: function(res) {
		var box = document.getElementById('ts_alert_box');
		if (!box) return;
		box.textContent = '';
		var raw;
		try { raw = JSON.parse(res.raw || '{}'); } catch (e) { return; }
		var expiry = raw && raw.Self && raw.Self.KeyExpiry;
		if (!expiry || expiry.indexOf('0001-') === 0) return;

		var days = Math.floor((new Date(expiry) - Date.now()) / 86400000);
		if (days > 30 || days < 0) return;

		box.appendChild(E('div', { 'class': 'alert-message warning' },
			days <= 1
				? _('The node key expires today. Please re-authenticate to keep this device connected.')
				: _('The node key expires in %d days. Please re-authenticate to keep this device connected.').format(days)));
	},

	handleLogin: function(ev) {
		if (this.accountBusy) return Promise.resolve();
		this.accountBusy = true;
		this.loginRequested = true;
		ev.target.disabled = true;
		ev.target.textContent = _('Requesting login URL...');
		return callLogin().then(function(res) {
			if (!res || !res.success) throw new Error((res && res.output) || _('Failed'));
		}).catch(L.bind(function(err) {
			this.loginRequested = false;
			ui.addNotification(null, E('p', err.message || String(err)));
		}, this)).finally(L.bind(function() {
			this.accountBusy = false;
			ev.target.disabled = false;
			ev.target.textContent = _('Login');
		}, this));
	},

	showLoginModal: function(url) {
		if (this.loginModalShown) return;
		this.loginModalShown = true;

		var qrBox = E('div', {
			'style': 'background:#fff;padding:16px;border-radius:8px;display:inline-block;line-height:0'
		});

		ui.showModal(_('Login to Tailscale'), [
			E('p', {}, _('Scan the QR code with your phone, or open the link below to authorize this device:')),
			E('div', { 'style': 'text-align:center;margin:16px 0' }, qrBox),
			E('p', { 'style': 'word-break:break-all;font-size:12px' }, url),
			E('div', { 'class': 'right' }, [
				E('a', { 'class': 'btn cbi-button cbi-button-apply', 'href': url, 'target': '_blank' },
					_('Open login page')),
				' ',
				E('button', { 'class': 'btn cbi-button', 'click': L.bind(function() {
					this.loginModalShown = false;
					this.loginRequested = false;
					ui.hideModal();
				}, this) }, _('Close'))
			])
		]);

		var renderQr = function(retries) {
			if (typeof qrcode === 'function') {
				var qr = qrcode(0, 'M');
				qr.addData(url);
				qr.make();
				qrBox.innerHTML = qr.createSvgTag(4, 0);
			} else if (retries > 0) {
				setTimeout(function() { renderQr(retries - 1); }, 400);
			}
		};
		renderQr(10);
	},

	handleNetcheck: function(ev) {
		var btn = ev.target;
		btn.disabled = true;
		btn.textContent = _('Testing connection...');
		return callNetcheck().then(function(res) {
			if (!res || res.success === false) throw new Error((res && res.output) || _('Detection failed.'));
			ui.showModal(_('Netcheck Result'), [
				E('pre', { 'style': 'max-height:400px;overflow:auto;font-size:12px' },
					(res && res.output) || _('No result')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		}).catch(function(err) { ui.addNotification(null, E('p', err.message || String(err))); }).finally(function() {
			btn.disabled = false;
			btn.textContent = _('Run netcheck');
		});
	},

	handleEnable: function(ev) {
		var val = ev.target.checked ? '1' : '0';
		ev.target.disabled = true;
		ui.showModal(null, E('p', { 'class': 'spinning' }, _('Applying changes...')));
		return callSetEnabled(val).then(L.bind(function(res) {
			if (!res || !res.success) throw new Error((res && res.output) || _('Failed'));
			ui.hideModal();
			return this.updateStatus();
		}, this)).catch(function(e) {
			ev.target.checked = val !== '1';
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to apply: %s').format(e.message || e)));
		}).finally(function() {
			ev.target.disabled = false;
		});
	},

	handleLogout: function() {
		ui.showModal(_('Logout & Unbind'), [
			E('p', {}, _('This will log out of Tailscale and unbind the device from your account. Continue?')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': L.bind(function() {
						ui.hideModal();
						return callLogout().then(function(res) {
							if (!res || !res.success) throw new Error((res && res.output) || _('Failed'));
							window.location.reload();
						}).catch(function(err) { ui.addNotification(null, E('p', err.message || String(err))); });
					}, this)
				}, _('Logout & Unbind'))
			])
		]);
	},

	handleUninstall: function() {
		ui.showModal(_('Clear identity and configuration'), [
			E('p', {}, _('This will logout, stop the service, and remove firewall rules, state files and configuration. The package itself can then be removed from System → Software. Continue?')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': L.bind(function() {
						ui.hideModal();
						ui.showModal(null, E('p', { 'class': 'spinning' }, _('Uninstalling...')));
						return callUninstall().then(function(res) {
							if (!res || !res.success) throw new Error((res && res.output) || _('Failed'));
							ui.hideModal();
							window.location.href = L.url('admin/status/overview');
						}).catch(function(err) {
							ui.hideModal();
							ui.addNotification(null, E('p', err.message || String(err)));
						});
					}, this)
				}, _('Clear identity and configuration'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
