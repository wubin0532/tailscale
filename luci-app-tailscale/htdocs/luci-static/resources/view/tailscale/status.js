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

var callLogout = rpc.declare({
	object: 'tailscale',
	method: 'logout',
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

var MESH_SVG = '<svg class="mesh" width="340" height="200" viewBox="0 0 340 200" fill="none">' +
	'<g stroke="#2dd4bf" stroke-width=".7" opacity=".35">' +
	'<path d="M40 150 120 60M120 60l100 30M220 90l80 60M40 150l180-60M120 60l180 90M40 150l260 0"/></g>' +
	'<g fill="#2dd4bf"><circle cx="40" cy="150" r="3.5"/><circle cx="120" cy="60" r="3.5" opacity=".8"/>' +
	'<circle cx="220" cy="90" r="3.5" opacity=".6"/><circle cx="300" cy="150" r="3.5" opacity=".9"/></g></svg>';

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('tailscale'),
			L.loadScript(L.resource('tailscale/qrcode.min.js'))
		]);
	},

	render: function() {
		if (!document.getElementById('ts-style'))
			document.head.appendChild(E('link', {
				'rel': 'stylesheet', 'id': 'ts-style',
				'href': L.resource('tailscale/style.css')
			}));

		var enabled = uci.get('tailscale', 'settings', 'enabled') == '1';

		var tgl = E('label', { 'class': 'ts-tgl' }, [
			E('input', { 'type': 'checkbox', 'id': 'ts_enabled' }),
			E('span')
		]);
		tgl.firstChild.checked = enabled;
		tgl.firstChild.addEventListener('change', L.bind(this.handleEnable, this));

		var v = E('div', { 'class': 'ts-wrap' }, [
			E('div', { 'class': 'ts-pagehead' }, [
				E('h1', {}, _('Service Status')),
				E('p', {}, [
					_('Tailscale connects your devices for easy access to remote resources. See '),
					E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale.com')
				])
			]),
			E('div', { 'class': 'ts-stagger' }, [
				E('div', { 'id': 'ts_alert_box' }),
				E('div', { 'class': 'ts-hero' }, [
					E('span', { 'html': MESH_SVG }),
					E('div', { 'class': 'ts-pulse off', 'id': 'ts_pulse' }, E('i')),
					E('div', { 'class': 'ts-hero-state' }, [
						E('h2', { 'id': 'ts_state' }, '—'),
						E('div', { 'class': 'sub', 'id': 'ts_sub' }, '—')
					]),
					E('div', { 'class': 'ts-hero-switch' }, [
						E('small', {}, _('Enable service')),
						tgl
					])
				]),
				E('div', { 'class': 'ts-stats' }, [
					E('div', { 'class': 'ts-stat' }, [
						E('div', { 'class': 'k' }, _('Current Node')),
						E('div', { 'class': 'v big', 'id': 'ts_node' }, '—')
					]),
					E('div', { 'class': 'ts-stat' }, [
						E('div', { 'class': 'k' }, 'Tailscale IP'),
						E('div', { 'class': 'v', 'id': 'ts_ips' }, '—')
					]),
					E('div', { 'class': 'ts-stat' }, [
						E('div', { 'class': 'k' }, _('Bound User')),
						E('div', { 'class': 'v big', 'id': 'ts_user' }, '—')
					]),
					E('div', { 'class': 'ts-stat' }, [
						E('div', { 'class': 'k' }, _('Advertised Routes')),
						E('div', { 'class': 'v', 'id': 'ts_routes' }, '—')
					])
				]),
				E('div', { 'class': 'ts-panel' }, [
					E('header', {}, [
						E('span', { 'class': 'ts-dot' }),
						E('h3', {}, _('Account & Connection'))
					]),
					E('div', { 'class': 'ts-row' }, [
						E('div', { 'class': 'lab' }, [
							_('Login state'),
							E('small', {}, _('Authorize this device with your tailnet account'))
						]),
						E('div', { 'class': 'ctl', 'id': 'ts_actions' })
					]),
					E('div', { 'class': 'ts-row' }, [
						E('div', { 'class': 'lab' }, [
							_('Connection quality'),
							E('small', {}, _('Check NAT type, DERP relay latency and IPv6 reachability'))
						]),
						E('div', { 'class': 'ctl' }, [
							E('button', {
								'class': 'ts-btn ts-btn-ghost',
								'click': L.bind(this.handleNetcheck, this)
							}, _('Run netcheck'))
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

			var pulse = document.getElementById('ts_pulse');
			if (!pulse) return;
			pulse.className = 'ts-pulse' + (running ? '' : ' off');

			var state = document.getElementById('ts_state');
			state.textContent = running ? 'Running' : _('Stopped');
			state.style.color = running ? 'var(--ts-ok)' : 'var(--ts-bad)';

			var sub = document.getElementById('ts_sub');
			if (running && res.backend_state === 'Running')
				sub.textContent = _('Connected to tailnet');
			else if (running)
				sub.textContent = res.backend_state || '—';
			else
				sub.textContent = _('Service is not running');

			var node = document.getElementById('ts_node');
			node.textContent = '';
			if (res.hostname) {
				node.appendChild(document.createTextNode(res.hostname));
				if (res.node_key)
					node.appendChild(E('span', { 'class': 'ts-tag ts-mono' },
						String(res.node_key).replace(/^nodekey:/, '').substring(0, 8) + '…'));
			} else {
				node.textContent = '—';
			}

			document.getElementById('ts_ips').textContent = res.ips || '—';

			var routes = uci.get('tailscale', 'settings', 'advertise_routes');
			document.getElementById('ts_routes').textContent =
				Array.isArray(routes) ? (routes.filter(Boolean).join(', ') || '—') : (routes || '—');

			var user = document.getElementById('ts_user');
			user.textContent = '';
			if (res.user)
				user.appendChild(E('a', {
					'href': 'https://login.tailscale.com/admin/machines',
					'target': '_blank'
				}, res.user + ' ↗'));
			else
				user.textContent = '—';

			var act = document.getElementById('ts_actions');
			act.textContent = '';
			if (res.backend_state === 'NeedsLogin' && res.auth_url) {
				act.appendChild(E('button', {
					'class': 'ts-btn ts-btn-primary',
					'click': L.bind(this.showLoginModal, this, res.auth_url)
				}, _('Login')));
			} else if (res.user) {
				act.appendChild(E('button', {
					'class': 'ts-btn ts-btn-danger',
					'click': L.bind(this.handleLogout, this)
				}, _('Logout & Unbind')));
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

		box.appendChild(E('div', { 'class': 'ts-alert' }, [
			E('strong', {}, '⚠ ' + _('Key expiring soon')),
			E('span', {}, days <= 1
				? _('The node key expires today. Please re-authenticate to keep this device connected.')
				: _('The node key expires in %d days. Please re-authenticate to keep this device connected.').format(days))
		]));
	},

	showLoginModal: function(url) {
		var qrBox = E('div', { 'class': 'ts-qr' });
		var modal = ui.showModal(_('Login to Tailscale'), [
			E('p', {}, _('Scan the QR code with your phone, or open the link below to authorize this device:')),
			E('div', { 'style': 'text-align:center;margin:16px 0' }, qrBox),
			E('p', { 'class': 'ts-mono', 'style': 'word-break:break-all;font-size:12px' }, url),
			E('div', { 'class': 'right' }, [
				E('a', { 'class': 'ts-btn ts-btn-primary', 'href': url, 'target': '_blank' }, _('Open login page')),
				' ',
				E('button', { 'class': 'ts-btn ts-btn-ghost', 'click': ui.hideModal }, _('Close'))
			])
		], 'ts-login-modal');

		if (typeof qrcode === 'function') {
			var qr = qrcode(0, 'M');
			qr.addData(url);
			qr.make();
			qrBox.innerHTML = qr.createSvgTag(4, 0);
		} else {
			qrBox.appendChild(E('p', {}, url));
		}
		return modal;
	},

	handleNetcheck: function(ev) {
		var btn = ev.target;
		btn.disabled = true;
		btn.textContent = _('Checking...');
		return callNetcheck().then(function(res) {
			ui.showModal(_('Netcheck Result'), [
				E('pre', { 'class': 'ts-log' }, (res && res.output) || _('No result')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'ts-btn ts-btn-ghost', 'click': ui.hideModal }, _('Close'))
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
				E('button', { 'class': 'ts-btn ts-btn-ghost', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'ts-btn ts-btn-danger',
					'click': L.bind(function() {
						ui.hideModal();
						return callLogout().then(function() { window.location.reload(); });
					}, this)
				}, _('Logout & Unbind'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
