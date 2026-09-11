'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require poll';

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

var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
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
		var enabled = uci.get('tailscale', 'settings', 'enabled') == '1';

		var checkbox = E('input', { 'type': 'checkbox', 'style': 'width:auto' });
		checkbox.checked = enabled;
		checkbox.addEventListener('change', L.bind(this.handleEnable, this));

		var table = E('table', { 'class': 'table' });
		var rows = [
			[ _('Enable service'), checkbox ],
			[ _('Service Status'), E('span', { 'id': 'ts_running' }, '—') ],
			[ _('Current Node'), E('span', { 'id': 'ts_node' }, '—') ],
			[ 'Tailscale IP', E('span', { 'id': 'ts_ips' }, '—') ],
			[ _('Advertised Routes'), E('span', { 'id': 'ts_routes' }, '—') ],
			[ _('Bound User'), E('span', { 'id': 'ts_user' }, '—') ]
		];

		rows.forEach(function(r) {
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, r[0]),
				E('td', { 'class': 'td left' }, r[1])
			]));
		});

		var v = E('div', {}, [
			E('h2', {}, _('Tailscale')),
			E('div', { 'class': 'cbi-section-descr' }, [
				_('Tailscale connects your devices for easy access to remote resources. See '),
				E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale.com')
			]),
			E('div', { 'id': 'ts_alert_box' }),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Service Status')),
				table
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Account & Connection')),
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Login state')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('span', { 'id': 'ts_login_desc' }, '—'),
							E('div', { 'style': 'margin-top:8px', 'id': 'ts_actions' })
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Connection quality')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('div', { 'class': 'cbi-value-description' },
								_('Check NAT type, DERP relay latency and IPv6 reachability')),
							E('button', {
								'class': 'btn cbi-button',
								'click': L.bind(this.handleNetcheck, this)
							}, _('Run netcheck'))
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Uninstall')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('div', { 'class': 'cbi-value-description' },
								_('Logout, stop the service, remove firewall rules, state files and configuration.')),
							E('button', {
								'class': 'btn cbi-button cbi-button-negative',
								'click': L.bind(this.handleUninstall, this)
							}, _('Uninstall'))
						])
					])
				])
			])
		]);

		poll.add(L.bind(this.updateStatus, this), 5);
		this.updateStatus();
		return v;
	},

	updateStatus: function() {
		return callGetStatus().then(L.bind(function(res) {
			res = res || {};
			var running = !!res.running;

			var el = document.getElementById('ts_running');
			if (!el) return;
			el.textContent = running ? 'Running' : _('Stopped');
			el.style.color = running ? 'green' : '#c62828';
			el.style.fontWeight = 'bold';

			var node = document.getElementById('ts_node');
			if (res.hostname && res.node_key && res.node_key.indexOf('nodekey:000') !== 0) {
				node.textContent = String(res.node_key).replace(/^nodekey:/, '').substring(0, 16) +
					'…  (' + res.hostname + ')';
			} else {
				node.textContent = '—';
			}

			document.getElementById('ts_ips').textContent = res.ips || '—';

			var routes = uci.get('tailscale', 'settings', 'advertise_routes');
			routes = Array.isArray(routes) ? routes.filter(Boolean) : (routes ? [routes] : []);
			document.getElementById('ts_routes').textContent = routes.join(', ') || '—';

			var user = document.getElementById('ts_user');
			user.textContent = '';
			if (res.user)
				user.appendChild(E('a', {
					'href': 'https://login.tailscale.com/admin/machines',
					'target': '_blank'
				}, res.user));
			else
				user.textContent = '—';

			var desc = document.getElementById('ts_login_desc');
			var act = document.getElementById('ts_actions');
			act.textContent = '';
			if (res.backend_state === 'NeedsLogin') {
				desc.textContent = _('Not logged in');
				act.appendChild(E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': L.bind(this.handleLogin, this)
				}, _('Login')));
				if (res.auth_url && (this.loginRequested || this.loginModalShown))
					this.showLoginModal(res.auth_url);
			} else if (res.user) {
				desc.textContent = _('Authorized');
				act.appendChild(E('button', {
					'class': 'btn cbi-button',
					'click': L.bind(this.handleLogout, this)
				}, _('Logout & Unbind')));
			} else {
				desc.textContent = res.backend_state || '—';
			}

			this.renderKeyAlert(res);
		}, this));
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
		this.loginRequested = true;
		ev.target.disabled = true;
		ev.target.textContent = _('Requesting login URL...');
		return callLogin();
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
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
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
		btn.textContent = _('Checking...');
		return callNetcheck().then(function(res) {
			ui.showModal(_('Netcheck Result'), [
				E('pre', { 'style': 'max-height:400px;overflow:auto;font-size:12px' },
					(res && res.output) || _('No result')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		}).finally(function() {
			btn.disabled = false;
			btn.textContent = _('Run netcheck');
		});
	},

	handleEnable: function(ev) {
		var val = ev.target.checked ? '1' : '0';
		ui.showModal(null, E('p', { 'class': 'spinning' }, _('Applying changes...')));
		uci.set('tailscale', 'settings', 'enabled', val);
		return uci.save().then(function() {
			return callInitAction('tailscale', val == '1' ? 'enable' : 'disable');
		}).then(function() {
			return callInitAction('tailscale', val == '1' ? 'start' : 'stop');
		}).then(function() {
			ui.hideModal();
			window.location.reload();
		}).catch(function(e) {
			ui.hideModal();
			ui.addNotification(null, E('p', _('Failed to apply: %s').format(e.message || e)));
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
						return callLogout().then(function() { window.location.reload(); });
					}, this)
				}, _('Logout & Unbind'))
			])
		]);
	},

	handleUninstall: function() {
		ui.showModal(_('Uninstall'), [
			E('p', {}, _('This will logout, stop the service, and remove firewall rules, state files and configuration. The package itself can then be removed from System → Software. Continue?')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': L.bind(function() {
						ui.hideModal();
						ui.showModal(null, E('p', { 'class': 'spinning' }, _('Uninstalling...')));
						return callUninstall().then(function() {
							ui.hideModal();
							window.location.href = L.url('admin/status/overview');
						});
					}, this)
				}, _('Uninstall'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
