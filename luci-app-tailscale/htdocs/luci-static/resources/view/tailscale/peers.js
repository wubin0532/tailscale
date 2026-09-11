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
		if (!document.getElementById('ts-style'))
			document.head.appendChild(E('link', {
				'rel': 'stylesheet', 'id': 'ts-style',
				'href': L.resource('tailscale/style.css')
			}));

		var v = E('div', { 'class': 'ts-wrap' }, [
			E('div', { 'class': 'ts-pagehead' }, [
				E('h1', {}, _('Peers')),
				E('p', {}, _('All devices in your tailnet. Refresh automatically every 5 seconds.'))
			]),
			E('div', { 'class': 'ts-panel' }, [
				E('header', {}, [
					E('span', { 'class': 'ts-dot' }),
					E('h3', {}, _('Online Devices')),
					E('span', { 'class': 'ts-tag', 'id': 'ts_peer_count', 'style': 'margin-left:auto' }, '—')
				]),
				E('table', { 'class': 'ts-table' }, [
					E('thead', {}, E('tr', {}, [
						E('th', {}, _('Node')),
						E('th', {}, 'Tailscale IP'),
						E('th', {}, _('OS')),
						E('th', {}, _('Status')),
						E('th', {}, _('Connection')),
						E('th', {}, _('Last Seen')),
						E('th', {}, '')
					])),
					E('tbody', { 'id': 'ts_peers' }, [
						E('tr', {}, E('td', { 'colspan': 7, 'style': 'color:var(--ts-dim)' }, _('Loading...')))
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
				tbody.appendChild(E('tr', {}, E('td',
					{ 'colspan': 7, 'style': 'color:var(--ts-dim)' },
					_('No peers found.'))));
				return;
			}

			peers.forEach(L.bind(function(p) {
				var ip = (p.TailscaleIPs || [])[0] || '—';
				var conn, cls;
				if (!p.Online) {
					conn = _('Offline'); cls = 'off';
				} else if (p.CurAddr) {
					conn = _('Direct'); cls = 'direct';
				} else {
					conn = _('Relay') + (p.Relay ? ' (' + p.Relay + ')' : ''); cls = 'relay';
				}

				var pingBtn = E('button', {
					'class': 'ts-btn ts-btn-ghost',
					'style': 'padding:5px 14px;font-size:12px',
					'click': L.bind(this.handlePing, this, ip, pingBtn)
				}, _('Ping'));

				tbody.appendChild(E('tr', {}, [
					E('td', {}, [
						E('strong', {}, p.HostName || '—'),
						p.ExitNode ? ' ' + '' : '',
						p.ExitNodeOption ? E('span', { 'class': 'ts-badge exit' }, 'exit') : ''
					]),
					E('td', { 'class': 'ts-mono' }, ip),
					E('td', {}, p.OS || '—'),
					E('td', {}, E('span', {
						'class': p.Online ? 'ts-online' : 'ts-offline'
					}, p.Online ? '● ' + _('Online') : '○ ' + _('Offline'))),
					E('td', {}, E('span', { 'class': 'ts-badge ' + cls }, conn)),
					E('td', { 'style': 'color:var(--ts-dim)' },
						p.Online ? _('now') : this.fmtSeen(p.LastSeen)),
					E('td', {}, pingBtn)
				]));
			}, this));
		}, this));
	},

	handlePing: function(ip, btn) {
		btn.disabled = true;
		btn.textContent = '…';
		return callPing(ip).then(function(res) {
			var out = (res && res.output) ? res.output.trim().split('\n') : [];
			btn.textContent = out.length ? out[out.length - 1].replace(/^pong from \S+ \(([^)]*)\).*in ([\d.]+ms).*/, '$1 · $2') : _('timeout');
		}).finally(function() {
			btn.disabled = false;
			setTimeout(function() { btn.textContent = _('Ping'); }, 4000);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
