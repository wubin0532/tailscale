'use strict';
'require view';
'require rpc';
'require poll';

var callGetLog = rpc.declare({
	object: 'tailscale',
	method: 'get_log',
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
				E('h1', {}, _('Logs')),
				E('p', {}, _('Tailscale daemon logs, refreshed every 3 seconds.'))
			]),
			E('div', { 'class': 'ts-panel' }, [
				E('header', {}, [
					E('span', { 'class': 'ts-dot' }),
					E('h3', {}, 'logread · tailscale'),
					E('div', { 'style': 'margin-left:auto' }, [
						E('button', {
							'class': 'ts-btn ts-btn-ghost',
							'style': 'padding:5px 14px;font-size:12px',
							'click': L.bind(function() {
								this.updateLog();
							}, this)
						}, _('Refresh'))
					])
				]),
				E('div', { 'style': 'padding:18px 24px' }, [
					E('pre', { 'class': 'ts-log', 'id': 'ts_log' }, _('Loading...'))
				])
			])
		]);

		poll.add(L.bind(this.updateLog, this), 3);
		this.updateLog();
		return v;
	},

	updateLog: function() {
		return callGetLog().then(function(res) {
			var pre = document.getElementById('ts_log');
			if (!pre) return;
			var nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
			pre.textContent = (res && res.log) || _('No log entries.');
			if (nearBottom || pre.textContent === _('Loading...'))
				pre.scrollTop = pre.scrollHeight;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
