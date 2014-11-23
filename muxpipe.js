
"use strict";

var net = require('net');

// Backpressure still needs to be done.
//
// If the mux's TCP connection itself is buffering, wait for drain as normal.
//
// If writing into a connection on mux, only write past the last acknowledged
// write up to the window_size, before waiting for more acknowledgements.
//
// The other end sends individual write acknowledgements for each connid,
// allowing us to proceed writing them independently.
//
// Backpressure should also apply as normal on the client side connections, and
// conversely we send acknowledgements for those writes back to the sender.

function main() {

	function close_cs() {
		for (var c in clients) {
			console.log('us  -> ' + c + ' end');
			clients[c].end();
			delete clients[c];
		}

		for (var i = 0; i < listeners.length; ++i) {
			try {
				listeners[i].close();
			} catch (e) {
				console.log('listener ' + i + ' closing error');
				console.log(e);
			}
		}
	}

    function cs_on_error(e) {
		console.log('us <-> ' + dport + ' error');
		console.log(e);
		close_cs();
	}

    function cs_on_close() {
	console.log('us <-> ' + dport + ' closed');
    }

    function cs_on_end() {
	console.log('us <-> ' + dport + ' end');
	close_cs();
    	console.log('us  -> ' + dport + ' end');
	cs.end();
    }

    function cs_on_readable() {
	console.log('us <-> ' + dport + ' readable');

	var data = cs.read();
	if (data === null) {
	console.log('us <-  ' + dport + ' got null data');
	    return;
	}

	console.log('us <-  ' + dport + ' read ' + data.length);

	if (prev_buf !== null) {
	    data = Buffer.concat([prev_buf, data]);
	    prev_buf = null;
	}

	console.log(data.toString('hex'));

	while (true) {
	    if (len_rem === 0) {
		if (data.length < 4) {
		    // wait for a full header before parsing out.
		    prev_buf = data;
		    return;
		}

		len_rem = data.readUInt16LE(0);
		reading_conn = data.readUInt16LE(2);
		data = data.slice(4);

		if (len_rem === 0) {
		    if (!(reading_conn in clients)) {
			console.log('us  -> ' + reading_conn + ' no such connection for close');
		    } else {
			console.log('us  -> ' + reading_conn + ' end');
			clients[reading_conn].end();
			delete clients[reading_conn];
		    }
		    continue;
		}
	    }

	    if (data.length <= len_rem) {

		if (!(reading_conn in clients)) {
			console.log('us  -> ' + reading_conn + ' no such connection for full write');
		} else {
			console.log('us  -> ' + reading_conn + ' full write ' + data.length);
		    clients[reading_conn].write(data);
		}
		len_rem -= data.length;
		return;
	    }

	    if (!(reading_conn in clients)) {
			console.log('us  -> ' + reading_conn + ' no such connection for part write');
	    } else {
			console.log('us  -> ' + reading_conn + ' part write ' + len_rem);
		clients[reading_conn].write(data.slice(0, len_rem));
	    }

	    data = data.slice(len_rem);
	    len_rem = 0;
	}
    }

	function listen_port(lport, n) {
		function cc_listening() {
		    console.log(lport + ' listening');
		}

		function cc_connected(cc) {
			function send_close() {
				var header = new Buffer(4);
				header.writeUInt16LE(0, 0);
				header.writeUInt16LE(myconn, 2);
				cs.write(header);
				console.log(lport + ' ' + myconn + ' -> ' + dport + ' close(4)');
			}

		    function cc_on_error(e) {
			console.log(lport + ' ' + myconn + ' <-> client error');
			console.log(e);
			send_close();
		    }

		    function cc_on_close() {
			console.log(lport + ' ' + myconn + ' <-> client closed');
		    }

		    function cc_on_readable() {
			console.log(lport + ' ' + myconn + ' <-> client readable');

			var data = cc.read();
			if (data === null) {
				console.log(lport + ' ' + myconn + ' <-  client sent null data');
			    return;
			}

			var header = new Buffer(4);
			header.writeUInt16LE(data.length, 0);
			header.writeUInt16LE(myconn, 2);

			cs.write(header);
			cs.write(data);

			console.log(lport + ' ' + myconn + '  -> ' + dport + ' write 4+' + data.length);
		    }

		    function cc_on_end() {
			console.log(lport + ' ' + myconn + ' <-  client end');
			send_close();
		    }

		    var myconn = conn_id++;

			console.log(lport + ' ' + myconn + ' <-> client connected');

		    cc.on('error', cc_on_error);
		    cc.on('close', cc_on_close);
		    cc.on('readable', cc_on_readable);
		    cc.on('end', cc_on_end);

		    var data = new Buffer(5);
		    data.writeUInt16LE(0x8000 | 0, 0);
		    // FIXME: will overflow quite soon - reuse old connids.
		    data.writeUInt16LE(myconn, 2);
		    data.writeUInt8(n, 4);

		    cs.write(data);
			console.log(lport + ' ' + myconn + ' <-> ' + dport + ' connect(5)');

		    clients[myconn] = cc;
		}

		var cc_l = net.createServer({ allowHalfOpen: true }, cc_connected);
		cc_l.listen(lport, cc_listening);
		return cc_l;
	}

    function cs_connected() {

	// starts at 2 because 0 would be useful as a cover/discardme channel,
	// and 1 could be a control channel for acknowledgements, etc.
	for (var i = 0; i < lports.length; ++i) {
		listeners.push(listen_port(parseInt(lports[i], 10), i));
	}
    }

	var conn_id = 2;
	var dport = parseInt(process.argv[2], 10);

	var lports = process.argv.slice(3);

    var len_rem = 0;
    var reading_conn = 0;
    var prev_buf = null;

	var listeners = [];
    var clients = {};

    // Immediately create the connection that will hold our mux. This is a
    // particularly important detail when used with coverpipe, but seems like a
    // good idea regardless.
    var cs = net.connect({ allowHalfOpen: true, port: dport }, cs_connected);
    cs.on('error', cs_on_error);
    cs.on('close', cs_on_close);
    cs.on('readable', cs_on_readable);
    cs.on('end', cs_on_end);
}

main();
