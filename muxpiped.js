
"use strict";

var net = require('net');

// Because all conns are going one after another along the pipe, having one
// stop would hold up the others behind it.

// Backpressure for these conns should be handled using pre-agreed sliding
// windows. The sender is committed to not send data past the agreed
// window_size + the most recent write acknowledgement sent by the other end.
// If the other side is not sending updated write acknowledgements for a
// connection then the window will be filled and the client will know not to
// send any more. The client won't need to resend, so only needs to know the
// ack, window_size, and sent numbers.

// A small window seems like a good idea. It should be enough that if
// it is full and the source is not sending, then if it starts
// drraining at full rate we still have enough time to ask the source
// for more data before it fully drains.

// This would be the source<->mux RTT multiplied by the drain
// bandwidth. The only reason we would expect buffer to be used if
// that is less than the source<->mux bandwidth, so we use that as a
// conservative measure. 600KB/s or 2MB/s are reasonable values these
// days. 100ms (0.1s) is an in-betweenish estimate for RTT. This gives
// 60KB or 200KB buffer. 128KB is in the middle.

// Is this overly simplistic? Should/can the buffer instead be defined in terms
// of latency somehow, like CoDeL?

// The buffers are held in local memory, and anything for which we have written
// and seen 'drain' since is ackable.

// We should still observe the feedback when writing to the pipe itself is
// buffering, and always read from the pipe as quickly as possible.

// Is 'readable' event round-robin? If not, should implement round-robin on top
// (just event robin, not for bandwidth).

function cs_connected(cs) {

    function ss_new(cur_con, port_id) {

	function send_close() {
	    var header = new Buffer(4);
	    header.writeUInt16LE(0, 0);
	    header.writeUInt16LE(cur_con, 2);
	    cs.write(header);
	}

	function ss_on_error(e) {
	    console.log('9000 <-> 8001 error');
	    console.log(e);
	    send_close();
	}

	function ss_on_close() {
	    console.log('9000 <-> 8001 closed');
	}

	function ss_on_readable() {
	    console.log('9000 <-> 8001 readable');
	    var data = ss.read();
	    if (data === null) {
		console.log('ss data was null');
		return;
	    }

	    var header = new Buffer(4);
	    header.writeUInt16LE(data.length, 0);
	    header.writeUInt16LE(cur_con, 2);
	    // TODO: backpressure
	    cs.write(header);
	    cs.write(data);
	}

	function ss_on_end() {
	    console.log('8001  -> 9000 FIN');
	    console.log('9000 ->  7000 FIN');
	    send_close();
	}

	function ss_connected() {
	    console.log('9000 ->  8001 connected');
	}

	var ss = net.connect({ allowHalfOpen: true, port: dports[port_id] }, ss_connected);

	if (cur_con in conns) {
	    console.log('overwriting previous connection! ' + cur_con);
	    conns[cur_con].end();
	}
	conns[cur_con] = ss;

	ss.on('error', ss_on_error);
	ss.on('close', ss_on_close);
	ss.on('readable', ss_on_readable);
	ss.on('end', ss_on_end);

	return ss;
    }

    function cs_on_readable() {
	var data = cs.read();
	if (data === null) {
	    console.log('cs data was null');
	    return;
	}

	console.log('cs readable');

	if (rem_buf !== null) {
	    data = Buffer.concat([rem_buf, data]);
	    rem_buf = null;
	}

	while (true) {
	    if (len_rem === 0) {
		if (data.length < 4) {
		    // wait for a full header before parsing out.
		    rem_buf = data;
		    return;
		}

		if ((data.readUInt16LE(0) & 0x8000) !== 0) {
		    if (data.length < 5) {
			rem_buf = data;
			return;
		    }

		    // connectioning
		    len_rem = data.readUInt16LE(0) & 0x7FFF;
		    cur_con = data.readUInt16LE(2);
		    var port_id = data.readUInt8(4);
		    data = data.slice(5);

			if (port_id >= dports.length) {
				console.log('client asked for port id we dont have');
			} else {
		    		conns[cur_con] = ss_new(cur_con, port_id);
			}

		} else {
		    len_rem = data.readUInt16LE(0);
		    cur_con = data.readUInt16LE(2);
		    data = data.slice(4);

			if (len_rem === 0) {
			    console.log('close sequence for ' + cur_con);
			    if (!(cur_con in conns)) {
				console.log('received end for non-existent connection ' + cur_con);
			    } else {
				conns[cur_con].end();
				// TODO: half-close
				delete conns[cur_con];
			    }
			    continue;
			}
		}
	    }

	    if (data.length <= len_rem) {

		if (!(cur_con in conns)) {
		    console.log('received data for non-existent connection ' + cur_con);
		} else {
		    console.log('ss '+cur_con+' wrote ' + data.length);
		    conns[cur_con].write(data);
		}

		len_rem -= data.length;
		return;
	    }

	    if (!(cur_con in conns)) {
		console.log('received data for non-existent connection ' + cur_con);
	    } else {
		console.log('ss '+cur_con+' wrote ' + len_rem);
		conns[cur_con].write(data.slice(0, len_rem));
	    }

	    data = data.slice(len_rem);
	    len_rem = 0;
	}
    }

    function cs_on_error(e) {
	console.log('7000 <-> 9000 error');
	console.log(e);
	for (var c in conns) {
	    conns[c].end();
	    delete conns[c];
	}
    }

    function cs_on_close() {
	console.log('7000 <-> 9000 closed');
    }

    function cs_on_end() {
	console.log('7000  -> 9000 FIN');
	console.log('9000 ->  8001 FIN');
	for (var c in conns) {
	    conns[c].end();
	    delete conns[c];
	}
    }

    var len_rem = 0;
    var cur_con = 0;
    var rem_buf = null;
    var conns = {};

    console.log('7000  -> 9000 connected');
    cs.on('error', cs_on_error);
    cs.on('close', cs_on_close);
    cs.on('readable', cs_on_readable);
}

var lport;
var dports = [];

function main() {
    function cs_listening() {
	console.log('listening on port ' + cs_l.address().port);
    }

	lport = parseInt(process.argv[2], 10);
	for (var i = 3; i < process.argv.length; ++i) {
		dports.push(parseInt(process.argv[i], 10));
	}
	var cs_l = net.createServer({ allowHalfOpen: true }, cs_connected);
	cs_l.listen(lport, cs_listening);

}

main();
