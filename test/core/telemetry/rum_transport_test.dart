import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_transport.dart';

Map<String, dynamic> event(int sequence) => <String, dynamic>{
      'endpoint': '/telemetry/$sequence',
      'method': 'GET',
      't_req': sequence,
    };

void main() {
  test('sends 200 events as four FIFO batches of 50', () async {
    final sent = <List<Map<String, dynamic>>>[];
    final transport = RumTransport(sender: (batch) async => sent.add(batch));
    for (var i = 0; i < 200; i++) {
      transport.enqueue(event(i));
    }

    await transport.flush();

    expect(sent.map((batch) => batch.length), <int>[50, 50, 50, 50]);
    expect(sent.first.first['t_req'], 0);
    expect(sent.last.last['t_req'], 199);
    expect(transport.pendingCount, 0);
  });

  test('sends 51 events as batches of 50 then one', () async {
    final sent = <List<Map<String, dynamic>>>[];
    final transport = RumTransport(sender: (batch) async => sent.add(batch));
    for (var i = 0; i < 51; i++) {
      transport.enqueue(event(i));
    }

    await transport.flush();

    expect(sent.map((batch) => batch.length), <int>[50, 1]);
  });

  test('snapshots caller maps and exposes immutable sender batch maps',
      () async {
    final source = event(1);
    final sent = <List<Map<String, dynamic>>>[];
    final transport = RumTransport(sender: (batch) async {
      sent.add(batch);
      expect(() => batch.add(event(2)), throwsUnsupportedError);
      expect(() => batch.single['t_req'] = 99, throwsUnsupportedError);
    });
    transport.enqueue(source);
    source['t_req'] = 99;

    await transport.flush();

    expect(sent.single.single['t_req'], 1);
  });

  test('rejects nested values outside the flat RUM event contract', () {
    final transport = RumTransport(sender: (_) async {});

    expect(
      () => transport.enqueue(<String, dynamic>{'endpoint': <String>[]}),
      throwsArgumentError,
    );
  });

  test('shares an in-flight flush with concurrent callers', () async {
    final gate = Completer<void>();
    var sends = 0;
    final transport = RumTransport(sender: (_) {
      sends++;
      return gate.future;
    });
    transport.enqueue(event(1));

    final first = transport.flush();
    final second = transport.flush();
    expect(identical(first, second), isTrue);
    expect(sends, 1);

    gate.complete();
    await first;
    expect(transport.pendingCount, 0);
  });

  test('keeps events enqueued while a batch awaits its sender', () async {
    final gate = Completer<void>();
    final sent = <List<Map<String, dynamic>>>[];
    final transport = RumTransport(sender: (batch) {
      sent.add(batch);
      return gate.future;
    });
    transport.enqueue(event(1));

    final flush = transport.flush();
    transport.enqueue(event(2));
    gate.complete();
    await flush;

    expect(sent.map((batch) => batch.single['t_req']), <int>[1, 2]);
    expect(transport.pendingCount, 0);
  });

  test('retains a failed second batch and retries it before later events',
      () async {
    final attempts = <List<Map<String, dynamic>>>[];
    var attempt = 0;
    final transport = RumTransport(sender: (batch) async {
      attempts.add(batch);
      attempt++;
      if (attempt == 2) throw StateError('fixture failure');
    });
    for (var i = 0; i < 120; i++) {
      transport.enqueue(event(i));
    }

    await transport.flush();
    expect(attempts.map((batch) => batch.length), <int>[50, 50]);
    expect(transport.pendingCount, 70);

    await transport.flush();
    expect(attempts[2].first['t_req'], 50);
    expect(attempts[3].first['t_req'], 100);
    expect(transport.pendingCount, 0);
  });

  test('retains the 200 most recent events after overflow during failure',
      () async {
    final gate = Completer<void>();
    final sent = <List<Map<String, dynamic>>>[];
    var failFirst = true;
    final transport = RumTransport(sender: (batch) {
      sent.add(batch);
      if (failFirst) return gate.future;
      return Future<void>.value();
    });
    for (var i = 0; i < 200; i++) {
      transport.enqueue(event(i));
    }

    final flush = transport.flush();
    for (var i = 200; i < 250; i++) {
      transport.enqueue(event(i));
    }
    failFirst = false;
    gate.completeError(StateError('fixture failure'));
    await flush;

    expect(transport.pendingCount, 200);
    await transport.flush();
    expect(sent[1].first['t_req'], 50);
  });

  test('reset prevents an older in-flight send from restoring a new queue',
      () async {
    final gate = Completer<void>();
    final sent = <List<Map<String, dynamic>>>[];
    var firstSend = true;
    final transport = RumTransport(sender: (batch) {
      sent.add(batch);
      if (firstSend) return gate.future;
      return Future<void>.value();
    });
    transport.enqueue(event(1));

    final oldFlush = transport.flush();
    transport.reset();
    transport.enqueue(event(2));
    firstSend = false;
    gate.completeError(StateError('fixture failure'));
    await oldFlush;
    await transport.flush();

    expect(sent.map((batch) => batch.single['t_req']), <int>[1, 2]);
    expect(transport.pendingCount, 0);
  });
}
