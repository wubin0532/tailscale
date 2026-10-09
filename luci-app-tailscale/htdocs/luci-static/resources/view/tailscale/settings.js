'use strict';
'require form';
'require view';
'require uci';
'require validation';
'require rpc';
'require poll';

var callGetStatus = rpc.declare({ object: 'tailscale', method: 'get_status', expect: {} });

function validateRoute(value) {
	if (!value) return true;
	var parts = value.split('/');
	var v6 = parts[0].indexOf(':') >= 0;
	var words = v6 ? validation.parseIPv6(parts[0]) : validation.parseIPv4(parts[0]);
	var width = v6 ? 16 : 8;
	var max = v6 ? 128 : 32;
	if (parts.length !== 2 || !/^\d+$/.test(parts[1]) || !words || Number(parts[1]) > max)
		return _('Enter a valid subnet in CIDR format.');
	var prefix = Number(parts[1]);
	for (var i = 0; i < words.length; i++) {
		var hostBits = Math.min(width, Math.max(0, (i + 1) * width - prefix));
		if (words[i] % Math.pow(2, hostBits) !== 0)
			return _('Enter a network address, for example 192.168.123.0/24, not 192.168.123.1/24.');
	}
	return true;
}

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
		var m, s, o;

		m = new form.Map('tailscale', _('Tailscale'), [
			_('To access your home network from this router, enable remote subnet access below. The home router must publish its LAN subnet and have that route approved in the Tailscale admin console. An internet exit node is not needed. See '),
			E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale.com')
		]);

		/* ---- Global settings ---- */
		s = m.section(form.NamedSection, 'settings', 'settings', _('Global Settings'));

		o = s.option(form.Flag, 'accept_routes', _('Access remote subnets'),
			_('Enable on the office router to access a home subnet such as 192.168.199.0/24. Before enabling, check that approved routes from other nodes do not overlap this router\'s LAN. A duplicate LAN route can make the router and internet unreachable. Publishing a local subnet is a separate setting.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'hostname', _('Tailscale device name'),
			_('Name reported to Tailscale, for example Office-1 or Home. Leave empty to use the router\'s system hostname. Save and apply to update it. A machine name manually renamed in the Tailscale admin console may differ.'));
		o.placeholder = 'Office-1';
		o.datatype = 'hostname';
		o.rmempty = true;

		o = s.option(form.DynamicList, 'advertise_routes', _('Share this router\'s local subnets'),
			_('Let other Tailscale devices access networks behind this router. On the home router, enter 192.168.199.0/24. On the office router, leave empty if you only need to access home. Enter a network address such as 192.168.123.0/24, not the router address 192.168.123.1/24. Each route also needs approval in the Tailscale admin console.'));
		o.datatype = 'cidr';
		o.validate = function(section, value) { return validateRoute(value); };
		o.rmempty = true;
		var lan = lanCidr();
		if (lan) o.value(lan, _('LAN subnet'));

		o = s.option(form.Value, 'auth_key', _('Login auth key (optional)'),
			_('For automatic login using a Tailscale auth key. Leave empty when already logged in or when using the login link or QR code. This is not the router password or a Tailscale API token.'));
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'login_server', _('Headscale server URL (optional)'),
			_('Leave empty to use official Tailscale. Fill in a complete HTTPS URL only when using your own Headscale server. Do not enter a username, router IP or subnet here.'));
		o.placeholder = 'https://headscale.example.com';
		o.validate = function(section, value) {
		return !value || /^https:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s]*)?$/.test(value)
			? true : _('Enter a complete HTTPS URL, or leave empty for official Tailscale.');
	};
		o.rmempty = true;

		o = s.option(form.Flag, 'ssh', _('Remote shell via Tailscale SSH'),
			_('Allow shell login to this router using Tailscale SSH and its access policy. This is separate from the router\'s normal SSH service and is not required to open the home router\'s web interface.'));
		o.default = '0';
		o.rmempty = false;

		/* ---- Exit node ---- */
		s = m.section(form.NamedSection, 'settings', 'settings', _('Internet routing (optional)'));

		o = s.option(form.Flag, 'advertise_exit_node', _('Offer this router as an internet exit'),
			_('Let other Tailscale devices use this router\'s internet connection. Requires approval in the Tailscale admin console. Leave disabled when you only need access to a home subnet.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'exit_node', _('Use another device for internet access'),
			_('Optional: route this router\'s internet traffic through an approved exit node. Enter that device\'s Tailscale IP (100.x.x.x) or name, not a LAN IP or subnet such as 192.168.123.0/24. Leave empty for normal internet access and for office-to-home subnet access.'));
		o.placeholder = _('Leave empty for normal internet access');
		o.validate = function(section, value) {
		return !value || /^[a-zA-Z0-9.:-]+$/.test(value)
			? true : _('Enter the exit node IP or device name, not a subnet.');
	};
		o.rmempty = true;

		o = s.option(form.Flag, 'exit_allow_lan', _('Keep local LAN access when using an exit'),
			_('Keep access to this router\'s own LAN while using another device for internet access. This does not enable access to a remote home subnet.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('exit_node', /\S+/);

		/* ---- Firewall ---- */
		s = m.section(form.NamedSection, 'auto', 'firewall', _('Firewall Settings'));

		o = s.option(form.Flag, 'fw_enabled', _('Create Tailscale firewall rules automatically'),
			_('Update only firewall rules created by this plugin. A Tailscale zone created manually is preserved; manage it in Network > Firewall.'));
		o.ucioption = 'enabled';
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.ListValue, 'input', _('Access to this router from Tailscale'),
			_('Default policy for Tailscale devices connecting to services on this router, such as its web interface or normal SSH. Access to other LAN devices is controlled separately below.'));
		o.value('ACCEPT', _('Accept'));
		o.value('REJECT', _('Reject'));
		o.value('DROP', _('Drop'));
		o.default = 'REJECT';
		o.depends('fw_enabled', '1');

		o = s.option(form.ListValue, 'output', _('Outbound traffic from this router'),
			_('Policy for traffic sent by this router through Tailscale. Usually keep Accept.'));
		o.value('ACCEPT', _('Accept')); o.value('REJECT', _('Reject')); o.value('DROP', _('Drop'));
		o.default = 'ACCEPT';
		o.depends('fw_enabled', '1');

		o = s.option(form.ListValue, 'forward', _('Forwarding within the Tailscale zone'),
			_('Policy for forwarding between interfaces in this zone. Keep Reject for office-to-home access; cross-zone forwarding is configured separately.'));
		o.value('REJECT', _('Reject')); o.value('ACCEPT', _('Accept')); o.value('DROP', _('Drop'));
		o.default = 'REJECT';
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'lan_forward', _('Allow local LAN to access Tailscale'),
			_('Create only LAN to Tailscale forwarding. Needed for office computers accessing home through this router; replies to established connections remain allowed.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'tailscale_to_lan', _('Allow Tailscale to initiate access to local LAN'),
			_('Allow new connections from Tailscale to this router\'s LAN. Disabled by default: no target zone is selected for Tailscale forwarding.'));
		o.default = '0';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'masq', _('Use this router\'s Tailscale IP for LAN traffic (NAT)'),
			_('Translate office LAN traffic leaving through Tailscale to this router\'s Tailscale IP, so replies can return without a separate office LAN route. Usually keep enabled for office devices accessing home through this router.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.DynamicList, 'masq_src', _('NAT source subnet limits'),
			_('Leave empty for all source addresses. On the office router, enter 192.168.123.0/24 to NAT only office LAN traffic. This is a NAT match, not an access rule.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.123.0/24';
		o.rmempty = true;
		o.depends({fw_enabled: '1', masq: '1'});

		o = s.option(form.DynamicList, 'masq_dest', _('NAT destination subnet limits'),
			_('Leave empty for all destinations. For office-to-home traffic, enter 192.168.199.0/24; for one Tailscale node, enter its 100.x.x.x address. This limits NAT, not which destinations are allowed.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.199.0/24';
		o.rmempty = true;
		o.depends({fw_enabled: '1', masq: '1'});

		o = s.option(form.DynamicList, 'ports', _('Allowed service ports on this router'),
			_('Add exceptions to the Reject or Drop policy above, for example 80 or 443 for the web interface and 22 for normal SSH. These rules allow both TCP and UDP. Leave empty for no exceptions; the selected policy still applies. This list does not restrict ports on other LAN devices.'));
		o.datatype = 'portrange';
		o.rmempty = true;
		o.placeholder = '22';
		o.depends('fw_enabled', '1');

		return m.render().then(function(formNode) {
			var error = E('div', { 'class': 'alert-message warning', 'style': 'display:none;white-space:pre-wrap' });
			poll.add(function() {
				return callGetStatus().then(function(res) {
					error.textContent = res.apply_error
						? _('Settings were not fully applied: %s').format(res.apply_error)
						: (res.busy ? _('Applying settings or waiting for login...') : '');
					error.style.display = error.textContent ? '' : 'none';
				});
			}, 5);
			return E('div', {}, [error, formNode]);
		});
	}
});
