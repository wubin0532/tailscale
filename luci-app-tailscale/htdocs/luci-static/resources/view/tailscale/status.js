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

var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

return view.extend({
	load: function() {
		return uci.load('tailscale');
	},

	render: function() {
		var enabled = uci.get('tailscale', 'settings', 'enabled') == '1';

		var checkbox = E('input', { 'type': 'checkbox', 'style': 'width:auto' });
		checkbox.checked = enabled;
		checkbox.addEventListener('change', L.bind(this.handleEnable, this));

		var table = E('table', { 'class': 'table' });
		var rows = [
			[ _('Enable'), checkbox ],
			[ _('Service Status'), E('span', { 'id': 'ts_running' }, '-') ],
			[ _('Current Node'), E('span', { 'id': 'ts_node' }, '-') ],
			[ _('Tailscale IP'), E('span', { 'id': 'ts_ips' }, '-') ],
			[ _('Bound User'), E('span', { 'id': 'ts_user' }, '-') ],
			[ '', E('div', { 'id': 'ts_actions' }) ]
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
				_('Tailscale connects your devices so you can securely access remote resources. For details, please visit '),
				E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale')
			]),
			E('h3', {}, _('Service Status')),
			table
		]);

		poll.add(L.bind(this.updateStatus, this), 5);
		this.updateStatus();
		return v;
	},

	updateStatus: function() {
		return callGetStatus().then(L.bind(function(res) {
			res = res || {};

			var el = document.getElementById('ts_running');
			if (!el)
				return;
			el.textContent = res.running ? _('Running') : _('Stopped');
			el.style.color = res.running ? 'green' : 'red';
			el.style.fontWeight = 'bold';

			var node = document.getElementById('ts_node');
			if (res.node_key) {
				var key = String(res.node_key).replace(/^nodekey:/, '');
				node.textContent = key.substring(0, 20) +
					(res.hostname ? '  (' + res.hostname + ')' : '');
			} else {
				node.textContent = '-';
			}

			document.getElementById('ts_ips').textContent = res.ips || '-';

			var user = document.getElementById('ts_user');
			user.textContent = '';
			if (res.user) {
				user.appendChild(E('a', {
					'href': 'https://login.tailscale.com/admin/machines',
					'target': '_blank'
				}, res.user));
			} else {
				user.textContent = '-';
			}

			var act = document.getElementById('ts_actions');
			act.textContent = '';
			if (res.backend_state === 'NeedsLogin' && res.auth_url) {
				act.appendChild(E('a', {
					'class': 'btn cbi-button cbi-button-apply',
					'href': res.auth_url,
					'target': '_blank'
				}, _('Login')));
			} else if (res.user) {
				var btn = E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'style': 'color:#4caf50'
				}, _('Logout and unbind'));
				btn.addEventListener('click', L.bind(this.handleLogout, this));
				act.appendChild(btn);
			}
		}, this));
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
		ui.showModal(_('Logout and unbind'), [
			E('p', _('This will log out of Tailscale and unbind the device from your account. Continue?')),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button-negative',
					'click': L.bind(function() {
						ui.hideModal();
						return callLogout().then(function() {
							window.location.reload();
						});
					}, this)
				}, _('Logout and unbind'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
