'use strict';
'require view';
'require rpc';
'require poll';

var callGetStatus = rpc.declare({
	object: 'tailscale',
	method: 'get_status',
	expect: { }
});

var callPing = rpc.declare({
	object: 'tailscale',
	method: 'ping',
	params: [ 'host' ],
	expect: { }
});

return view.extend({
	render: function() {
		var v = E('div', {}, [
			E('h2', {}, _('Peers')),
			E('div', { 'class': 'cbi-section-descr' },
				_('All devices in your tailnet. Refresh automatically every 5 seconds.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [
					_('Online Devices'),
					' ',
					E('span', { 'id': 'ts_peer_count', 'style': 'font-weight:normal;color:#888' }, '')
				]),
				E('table', { 'class': 'table cbi-section-table' }, [
					E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, _('Node')),
						E('th', { 'class': 'th' }, 'Tailscale IP'),
						E('th', { 'class': 'th' }, _('OS')),
						E('th', { 'class': 'th' }, _('Status')),
						E('th', { 'class': 'th' }, _('Connection')),
						E('th', { 'class': 'th' }, _('Last Seen')),
						E('th', { 'class': 'th' }, '')
					])),
					E('tbody', { 'id': 'ts_peers' }, [
						E('tr', { 'class': 'tr' }, E('td', { 'class': 'td', 'colspan': 7 }, _('Loading...')))
					])
				])
			])
		]);

		poll.add(L.bind(this.updatePeers, this), 5);
		this.updatePeers();
		return v;
	},

	fmtSeen: function(ts) {
		if (!ts || ts.indexOf('0001-') === 0) return '—';
		var diff = Math.floor((Date.now() - new Date(ts)) / 1000);
		if (diff < 60) return _('%ds ago').format(diff);
		if (diff < 3600) return _('%dm ago').format(Math.floor(diff / 60));
		if (diff < 86400) return _('%dh ago').format(Math.floor(diff / 3600));
		return _('%dd ago').format(Math.floor(diff / 86400));
	},

	updatePeers: function() {
		return callGetStatus().then(L.bind(function(res) {
			var tbody = document.getElementById('ts_peers');
			if (!tbody) return;

			var raw;
			try { raw = JSON.parse(res.raw || '{}'); } catch (e) { raw = {}; }

			var peers = [];
			Object.keys(raw.Peer || {}).forEach(function(k) {
				peers.push(raw.Peer[k]);
			});
			peers.sort(function(a, b) {
				if (!!b.Online !== !!a.Online) return (b.Online ? 1 : 0) - (a.Online ? 1 : 0);
				return (a.HostName || '').localeCompare(b.HostName || '');
			});

			var online = peers.filter(function(p) { return p.Online; }).length;
			document.getElementById('ts_peer_count').textContent =
				_('%d online / %d total').format(online, peers.length);

			tbody.textContent = '';
			if (!peers.length) {
				tbody.appendChild(E('tr', { 'class': 'tr' }, E('td',
					{ 'class': 'td', 'colspan': 7 }, _('No peers found.'))));
				return;
			}

			peers.forEach(L.bind(function(p) {
				var ip = (p.TailscaleIPs || [])[0] || '—';
				var conn;
				if (!p.Online)
					conn = '—';
				else if (p.CurAddr)
					conn = _('Direct');
				else
					conn = _('Relay') + (p.Relay ? ' (' + p.Relay + ')' : '');

				var pingBtn = E('button', {
					'class': 'btn cbi-button',
					'style': 'padding:2px 10px',
					'click': L.bind(this.handlePing, this, ip, pingBtn)
				}, _('Ping'));

				var statusEl = E('span', {
					'style': 'font-weight:bold;color:' + (p.Online ? 'green' : '#999')
				}, p.Online ? _('Online') : _('Offline'));

				tbody.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, [
						E('strong', {}, p.HostName || '—'),
						p.ExitNodeOption ? E('span', { 'class': 'badge', 'style': 'margin-left:6px' }, 'exit') : ''
					]),
					E('td', { 'class': 'td' }, ip),
					E('td', { 'class': 'td' }, p.OS || '—'),
					E('td', { 'class': 'td' }, statusEl),
					E('td', { 'class': 'td' }, conn),
					E('td', { 'class': 'td' }, p.Online ? _('now') : this.fmtSeen(p.LastSeen)),
					E('td', { 'class': 'td' }, pingBtn)
				]));
			}, this));
		}, this));
	},

	handlePing: function(ip, btn) {
		btn.disabled = true;
		btn.textContent = '…';
		return callPing(ip).then(function(res) {
			var out = (res && res.output) ? res.output.trim().split('\n') : [];
			btn.textContent = out.length
				? out[out.length - 1].replace(/^pong from \S+ \(([^)]*)\).*in ([\d.]+ms).*/, '$1 · $2')
				: _('timeout');
		}).finally(function() {
			btn.disabled = false;
			setTimeout(function() { btn.textContent = _('Ping'); }, 4000);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
