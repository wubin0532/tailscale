# Portable IPv4/IPv6 CIDR validation and overlap checking (BusyBox awk).
# Input: local <cidr>, remote <cidr>, advertise <cidr>.
function bits(n, width, s, i) {
	s = ""
	for (i = 0; i < width; i++) { s = (n % 2) s; n = int(n / 2) }
	return s
}
function ipv4(s, a, n, i, out) {
	n = split(s, a, "."); out = ""
	if (n != 4) return ""
	for (i = 1; i <= 4; i++) {
		if (a[i] !~ /^[0-9]+$/ || a[i] + 0 > 255 || (length(a[i]) > 1 && substr(a[i], 1, 1) == "0")) return ""
		out = out bits(a[i] + 0, 8)
	}
	return out
}
function hexpart(s, a, n, i, j, val, digit, out) {
	if (s == "") return ""
	n = split(s, a, ":"); out = ""
	for (i = 1; i <= n; i++) {
		if (a[i] == "" || length(a[i]) > 4 || a[i] !~ /^[0-9a-f]+$/) return "!"
		val = 0
		for (j = 1; j <= length(a[i]); j++) {
			digit = index("0123456789abcdef", substr(a[i], j, 1)) - 1
			val = val * 16 + digit
		}
		out = out bits(val, 16)
	}
	return out
}
function ipv6(s, pos, left, right, missing, tail, a, n) {
	s = tolower(s)
	# IPv4 embedded in the last 32 bits.
	if (index(s, ".")) {
		n = split(s, a, ":"); tail = ipv4(a[n]); if (tail == "") return ""
		s = substr(s, 1, length(s) - length(a[n])) "0:0"
	}
	pos = index(s, "::")
	if (pos) {
		left = hexpart(substr(s, 1, pos - 1)); right = hexpart(substr(s, pos + 2))
		if (left == "!" || right == "!") return ""
		missing = 128 - length(left) - length(right)
		if (missing < 16) return ""
		s = left bits(0, missing) right
	} else {
		s = hexpart(s); if (length(s) != 128 || s == "!") return ""
	}
	if (tail != "") s = substr(s, 1, 96) tail
	return s
}
function cidr(s, a, n, prefix, address) {
	n = split(s, a, "/")
	if (n != 2 || a[2] !~ /^[0-9]+$/) return 0
	address = index(a[1], ":") ? ipv6(a[1]) : ipv4(a[1])
	if (address == "" || a[2] + 0 > length(address)) return 0
	parsedBits = address; parsedPrefix = a[2] + 0
	return 1
}
$1 == "local" {
	if (!cidr($2)) { print "Cannot inspect local address: " $2; invalid = 1; next }
	localName[++count] = $2; localBits[count] = parsedBits; localPrefix[count] = parsedPrefix
}
$1 == "remote" || $1 == "advertise" {
	if (!cidr($2)) { print "Invalid subnet: " $2; invalid = 1; next }
	if ($1 == "advertise" && substr(parsedBits, parsedPrefix + 1) ~ /1/) {
		print "Use a network address without host bits: " $2; invalid = 1
	}
	if ($1 == "remote" && parsedPrefix > 0) {
		remoteName[++remoteCount] = $2; remoteBits[remoteCount] = parsedBits; remotePrefix[remoteCount] = parsedPrefix
	}
}
END {
	for (r = 1; r <= remoteCount; r++) for (l = 1; l <= count; l++) {
		if (length(remoteBits[r]) != length(localBits[l])) continue
		n = remotePrefix[r] < localPrefix[l] ? remotePrefix[r] : localPrefix[l]
		if (substr(remoteBits[r], 1, n) == substr(localBits[l], 1, n)) {
			print "Remote subnet " remoteName[r] " overlaps local network " localName[l]; invalid = 1
		}
	}
	if (invalid) exit 1
}
