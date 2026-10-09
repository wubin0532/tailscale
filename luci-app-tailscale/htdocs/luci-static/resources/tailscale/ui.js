'use strict';
'require baseclass';

return baseclass.extend({
	wrap: function(title, description, children) {
		if (!document.getElementById('ts-v2-style'))
			document.head.appendChild(E('link', { id: 'ts-v2-style', rel: 'stylesheet', href: L.resource('tailscale/ui-v2-r1.css') }));
		return E('div', { 'class': 'ts-app' }, [
			E('div', { 'class': 'ts-header' }, [E('div', {}, [E('h2', {}, title), E('p', {}, description)]), E('span', { 'class': 'ts-version' }, 'v2.0')])
		].concat(children));
	},
	message: function(res) {
		if (!res.running) return _('Service stopped. Enable it on the status page.');
		if (res.backend_state === 'NeedsLogin') return _('Sign in on the status page to see your devices.');
		if (res.backend_state === 'NeedsMachineAuth') return _('Approve this device in the Tailscale admin console.');
		if (res.success === false || res.stale) return res.error || _('Status could not be refreshed.');
		if (!res.online) return _('Control connection is not ready. The device list may be incomplete.');
		return '';
	},
	updated: function(value) {
		return value ? _('Updated: %s').format(new Date(Number(value) * 1000).toLocaleTimeString()) : _('Waiting for status');
	}
});
