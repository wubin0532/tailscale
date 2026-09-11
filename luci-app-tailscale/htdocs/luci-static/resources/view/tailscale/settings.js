'use strict';
'require form';
'require view';
'require uci';

function lanCidr() {
	var ip = uci.get('network', 'lan', 'ipaddr');
	var mask = uci.get('network', 'lan', 'netmask');
	if (!ip || !mask) return null;

	var ipB = ip.split('.').map(Number);
	var mB = mask.split('.').map(Number);
	if (ipB.length !== 4 || mB.length !== 4) return null;

	var bits = mB.reduce(function(n, o) {
		return n + (o.toString(2).match(/1/g) || []).length;
	}, 0);
	var net = ipB.map(function(o, i) { return o & mB[i]; }).join('.');
	return net + '/' + bits;
}

return view.extend({
	load: function() {
		return uci.load('network');
	},

	render: function() {
		if (!document.getElementById('ts-style'))
			document.head.appendChild(E('link', {
				'rel': 'stylesheet', 'id': 'ts-style',
				'href': L.resource('tailscale/style.css')
			}));

		var m, s, o;

		m = new form.Map('tailscale', _('Tailscale'), [
			_('Tailscale connects your devices for easy access to remote resources. See '),
			E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale.com')
		]);

		/* ---- Global settings ---- */
		s = m.section(form.NamedSection, 'settings', 'settings', _('Global Settings'));

		o = s.option(form.Flag, 'accept_routes', _('Accept routes'),
			_('Accept subnet routes advertised by other nodes.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'hostname', _('Device Name'),
			_('Leave empty to use the device name.'));
		o.rmempty = true;

		o = s.option(form.DynamicList, 'advertise_routes', _('Advertise routes'),
			_('Subnets allowed to be accessed through this node, e.g. 192.168.100.0/24.'));
		o.datatype = 'cidr';
		o.rmempty = true;
		var lan = lanCidr();
		if (lan) o.value(lan, _('LAN subnet'));

		o = s.option(form.Value, 'auth_key', _('Auth Key'),
			_('Optional. Use an auth key to log in automatically without browser interaction.'));
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'login_server', _('Control server'),
			_('Leave empty for the official Tailscale control plane, or enter your Headscale server URL.'));
		o.placeholder = 'https://controlplane.tailscale.com';
		o.rmempty = true;

		o = s.option(form.Flag, 'ssh', _('Tailscale SSH'),
			_('Allow tailnet devices to SSH into this router via Tailscale authentication.'));
		o.default = '0';
		o.rmempty = false;

		/* ---- Exit node ---- */
		s = m.section(form.NamedSection, 'settings', 'settings', _('Exit Node'));

		o = s.option(form.Flag, 'advertise_exit_node', _('Advertise as exit node'),
			_('Allow other tailnet devices to route all their traffic through this router.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'exit_node', _('Use exit node'),
			_('Route this router\'s traffic through another exit node. Enter its Tailscale IP or hostname; leave empty to disable.'));
		o.rmempty = true;

		o = s.option(form.Flag, 'exit_allow_lan', _('Allow LAN access'),
			_('Allow direct access to the local LAN while using an exit node.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('exit_node', '!empty');

		/* ---- Firewall ---- */
		s = m.section(form.NamedSection, 'auto', 'firewall', _('Firewall Settings'));

		o = s.option(form.Flag, 'fw_enabled', _('Auto configure firewall'),
			_('Automatically create the tailscale firewall zone and forwarding rules.'));
		o.ucioption = 'enabled';
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.ListValue, 'input', _('Input policy'),
			_('Policy for traffic from the Tailscale network to this router.'));
		o.value('ACCEPT', _('Accept'));
		o.value('REJECT', _('Reject'));
		o.value('DROP', _('Drop'));
		o.default = 'ACCEPT';
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'lan_forward', _('Allow LAN forwarding'),
			_('Allow traffic forwarding between the LAN and Tailscale zones.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'masq', _('NAT masquerading'),
			_('Enable NAT masquerading on the Tailscale zone. Required when this node acts as an exit node or subnet router.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.DynamicList, 'ports', _('Inbound port whitelist'),
			_('Leave empty to allow all ports. When set, only the listed ports are allowed from the Tailscale network; set the input policy to Reject or Drop for this to take effect.'));
		o.datatype = 'portrange';
		o.rmempty = true;
		o.placeholder = '22';
		o.depends('fw_enabled', '1');

		return m.render().then(function(node) {
			return E('div', { 'class': 'ts-wrap' }, node);
		});
	}
});
