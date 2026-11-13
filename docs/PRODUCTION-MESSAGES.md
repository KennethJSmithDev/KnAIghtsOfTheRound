# Inspect KotR production message classes

From the repository root, run the source inventory with Python 3:

```sh
python scripts/production-messages.py
python scripts/production-messages.py --production KnAIghts.Context.Production
```

The JSON lists each configured production item and its owning class. Operation
entries pair the request class in `MessageMap` with the response type declared
by the mapped handler. BPL entries include process input and output classes
and the message types at each call site. For example, the review flow declares
`EnsLib.Workflow.TaskRequest` and `EnsLib.Workflow.TaskResponse` on its
`KnAIghtsReviewers` call.

For KotR's single-route services, the inventory reads the concrete input guard
and outgoing request from the service source. When a service forwards the
synchronous response, the inventory resolves its class through the target
operation's matching message map.

An `external-class` item requires the installed vendor class or a separately
verified call site to establish its contract. An `unresolved` item or a
`null` class means the source inventory could not establish that type.
The tool reads the checked-in source. It has no IRIS connection and cannot
report deployed settings, live traffic, permissions, or dynamic dispatch.

## Look up a route before drafting a transformation

```sh
python scripts/production-messages.py --production KnAIghts.Context.Production --route KnAIghtsReviewFlow KnAIghtsContext
```

Each suggestion comes from a declared service send or BPL call. The result
shows the class declared by the caller and the destination response class when
an exact request match establishes it. For an external vendor class, the BPL
call can still describe its own types. A missing route or unknown target
contract stays explicit. This lookup provides source-backed hints for a mapping
review and does not generate or run a transformation.
