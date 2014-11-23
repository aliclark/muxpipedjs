muxpipedjs
==========

{ssh,mutt} | pipemux | coverpipe | spiped -e | ~~~~ | spiped -d | coverpiped | pipemuxd | {sshd,postfix}

What it does
------------

muxpiped is one component of a three part pipe that allows secure
constant-cover connections.

muxpipe/muxpiped multiplexes TCP connections over a single existing connection.
It gives each connection its own transfer window (implemented soon), which
reduces head-of-line issues.

It also minimises latency by allowing each new connection to send data
immediately, without any additional handshaking.

When combined with spiped, this hides the number of services hosted on a
machine, and likely hides any indication as to the nature of those services
(which 2 spiped instances listening on 8022 and 8025 might do).

muxpiped initialises the mux connection on startup, so when combined with
coverpiped well result in cover data being set up immediately on the
connection. Any new TCP connections will be completely indistinguishable from
cover traffic, so it is not possible for an attacker to see when connections
are being made if at all.

What it does not
----------------

For ease of implementation, this project uses TCP instead of UDP as a
transport. Using UDP would allow each stream to behave independently in the
face of packet loss, so losing a packet concerning just one stream would not
adversely impact any of the other streams, as it currently does.

However the improvement would only be linear in the number of streams and it
would take significant effort to use UDP, probably with its own drawbacks.
